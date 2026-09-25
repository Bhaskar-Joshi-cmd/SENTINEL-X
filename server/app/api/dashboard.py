import asyncio
from functools import partial
from fastapi import APIRouter

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary")
async def summary():
    admin = get_admin_client()

    # Run the four independent Supabase queries CONCURRENTLY in threads.
    # The sync supabase-py client blocks whatever thread it runs on; running
    # each query in the default executor means all four overlap instead of
    # queueing behind each other (that serialisation was the ~15s stall).
    loop = asyncio.get_running_loop()

    def q_stations():
        return admin.table("hydro_stations").select("id,station_code,station_name,river_name,district,state,latitude,longitude,warning_level_m,danger_level_m,highest_flood_level_m").in_("station_code", ["CWC_MELLI", "CWC_NANGLAMORAGHAT"]).execute().data or []

    def q_latest(station_ids):
        return (
            admin.table("hydro_readings")
            .select("id,station_id,observed_at,water_level_m,water_level_rate_m_hr,data_mode")
            .in_("station_id", station_ids)
            .order("observed_at", desc=True)
            .limit(len(station_ids) * 2)
            .execute()
            .data
            or []
        )

    def q_evals():
        return (
            admin.table("rule_evaluations")
            .select("id,hydro_reading_id,sensor_reading_id,community_report_id,event_id,engine_version,level_score,rate_score,sensor_score,community_score,persistence_score,total_score,risk_level,alert_recommended,alert_priority,reasons,evaluated_at")
            .order("evaluated_at", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )

    def q_alerts():
        return (
            admin.table("alerts")
            .select("id,alert_code,title,description,instruction,priority,urgency,severity,certainty,status,created_at,event_id")
            .in_("status", ["pending_approval", "approved", "dispatching", "active"])
            .order("created_at", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )

    stations = await loop.run_in_executor(None, q_stations)
    station_ids = [station["id"] for station in stations]
    all_latest, recent_evaluations, active_alerts = await asyncio.gather(
        loop.run_in_executor(None, partial(q_latest, station_ids)),
        loop.run_in_executor(None, q_evals),
        loop.run_in_executor(None, q_alerts),
    )
    reading_by_station = {}
    for r in all_latest:
        sid = str(r.get("station_id"))
        if sid not in reading_by_station:
            reading_by_station[sid] = r
    latest = []
    for station in stations:
        r = reading_by_station.get(str(station["id"]))
        latest.append({"station": station, "latest_reading": r or None})

    return {
        "stations": latest,
        "recent_evaluations": recent_evaluations,
        "active_alerts": active_alerts,
    }

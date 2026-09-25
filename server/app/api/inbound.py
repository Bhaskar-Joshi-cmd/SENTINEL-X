from __future__ import annotations

import asyncio
from functools import partial

from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/inbound", tags=["Inbound"])


def _latest_timestamp(rows: list[dict], *fields: str) -> str | None:
    values: list[str] = []
    for row in rows:
        for field in fields:
            value = row.get(field)
            if value:
                values.append(str(value))
    return max(values) if values else None


def _safe_error(exc: Exception) -> str:
    return str(exc).split("\n", 1)[0][:300]


@router.get("/summary")
async def inbound_summary(
    river_code: str = Query(..., min_length=2),
    limit: int = Query(default=50, ge=1, le=100),
):
    """Return normalized inbound evidence for one basin.

    This endpoint intentionally uses select("*") for the project tables rather than
    maintaining a brittle allow-list of every optional column. The frontend receives
    a normalized shape, while future schema additions remain backward compatible.
    """
    admin = get_admin_client()
    code = river_code.upper().strip()
    # Independent Supabase reads run concurrently in threads (the sync
    # supabase-py client blocks its thread, so executor overlap removes the
    # serial queueing that caused multi-second stalls on river switch).
    loop = asyncio.get_running_loop()

    def q_basins():
        return admin.table("basins").select("*").eq("basin_code", code).limit(1).execute().data or []

    basin_rows = await loop.run_in_executor(None, q_basins)
    if not basin_rows:
        raise HTTPException(status_code=404, detail="River not found")

    basin = basin_rows[0]
    basin_id = basin["id"]

    def q_stations():
        return admin.table("hydro_stations").select("*").eq("basin_id", basin_id).order("station_name").execute().data or []

    def q_devices():
        return admin.table("sensor_devices").select("*").execute().data or []

    def q_villages():
        return admin.table("villages").select("*").eq("basin_id", basin_id).execute().data or []

    stations, devices, villages = await asyncio.gather(
        loop.run_in_executor(None, q_stations),
        loop.run_in_executor(None, q_devices),
        loop.run_in_executor(None, q_villages),
    )
    station_ids = [str(row["id"]) for row in stations if row.get("id")]
    station_map = {str(row["id"]): row for row in stations if row.get("id")}
    device_map = {str(row.get("id")): row for row in devices if row.get("id")}
    village_map = {str(row.get("id")): row.get("village_name") for row in villages if row.get("id")}

    hydro: list[dict] = []
    source_errors: list[dict] = []

    # HYDRO
    if station_ids:
        try:
            rows = (
                admin.table("hydro_readings")
                .select("*")
                .in_("station_id", station_ids)
                .order("observed_at", desc=True)
                .limit(limit)
                .execute()
                .data
                or []
            )
            for row in rows:
                station = station_map.get(str(row.get("station_id")), {})
                hydro.append(
                    {
                        **row,
                        "station_code": station.get("station_code", "—"),
                        "station_name": station.get("station_name", "—"),
                        "river_name": station.get("river_name"),
                    }
                )
        except Exception as exc:
            source_errors.append({"source": "hydro", "message": _safe_error(exc)})

    # SENSOR DEVICES + READINGS
    sensors: list[dict] = []
    try:
        devices = (
            admin.table("sensor_devices")
            .select("*")
            .execute()
            .data
            or []
        )
        device_map = {str(row.get("id")): row for row in devices if row.get("id")}
    except Exception as exc:
        devices = []
        device_map = {}
        source_errors.append({"source": "sensor_devices", "message": _safe_error(exc)})

    try:
        sensor_rows = (
            admin.table("sensor_readings")
            .select("id,sensor_id,observed_at,numeric_value,unit,battery_percentage,latitude,longitude,quality_score,raw_data,created_at")
            .order("observed_at", desc=True)
            .limit(min(limit, 50))
            .execute()
            .data
            or []
        )

        station_id_set = set(station_ids)
        for row in sensor_rows:
            raw = row.get("raw_data") or {}
            if not isinstance(raw, dict):
                raw = {}

            linked_station_id = raw.get("station_id")
            if not linked_station_id or str(linked_station_id) not in station_id_set:
                continue

            device = device_map.get(str(row.get("sensor_id")), {})
            station = station_map.get(str(linked_station_id), {})

            sensors.append(
                {
                    "id": row.get("id"),
                    "sensor_id": row.get("sensor_id"),
                    "sensor_code": device.get("sensor_code") or raw.get("sensor_code") or "Unknown sensor",
                    "sensor_type": device.get("sensor_type") or raw.get("sensor_type") or "unknown",
                    "numeric_value": row.get("numeric_value"),
                    "unit": row.get("unit") or device.get("unit"),
                    "observed_at": row.get("observed_at") or row.get("created_at"),
                    "battery_percentage": row.get("battery_percentage"),
                    "latitude": row.get("latitude"),
                    "longitude": row.get("longitude"),
                    "quality_score": row.get("quality_score"),
                    "station_id": linked_station_id,
                    "station_name": station.get("station_name"),
                    "station_code": station.get("station_code"),
                    "river_name": station.get("river_name"),
                }
            )
            if len(sensors) >= limit:
                break
    except Exception as exc:
        source_errors.append({"source": "sensors", "message": _safe_error(exc)})

    # COMMUNITY REPORTS
    community: list[dict] = []
    try:
        villages = (
            admin.table("villages")
            .select("*")
            .eq("basin_id", basin["id"])
            .execute()
            .data
            or []
        )
        village_map = {str(row.get("id")): row.get("village_name") for row in villages if row.get("id")}
    except Exception as exc:
        villages = []
        village_map = {}
        source_errors.append({"source": "villages", "message": _safe_error(exc)})

    try:
        if station_ids:
            report_rows = (
                admin.table("community_reports")
                .select("*")
                .in_("station_id", station_ids)
                .order("submitted_at", desc=True)
                .limit(limit)
                .execute()
                .data
                or []
            )
        else:
            report_rows = []

        for row in report_rows:
            station = station_map.get(str(row.get("station_id")), {})
            community.append(
                {
                    **row,
                    "village_name": village_map.get(str(row.get("village_id"))) if row.get("village_id") else None,
                    "station_name": station.get("station_name"),
                    "station_code": station.get("station_code"),
                }
            )
    except Exception as exc:
        source_errors.append({"source": "community", "message": _safe_error(exc)})

    # RULE EVALUATIONS
    evaluations: list[dict] = []
    hydro_ids = [str(row["id"]) for row in hydro if row.get("id")]
    try:
        # Pull the most recent evaluation records and optionally associate them with
        # the current basin by hydro_reading_id. This avoids dependence on optional
        # columns and also allows evaluation rows to be displayed even when some of
        # the newest hydro records have not been evaluated yet.
        evaluation_rows = (
            admin.table("rule_evaluations")
            .select("id,hydro_reading_id,sensor_reading_id,community_report_id,event_id,total_score,risk_level,alert_recommended,alert_priority,reasons,evaluated_at")
            .order("evaluated_at", desc=True)
            .limit(min(limit, 40))
            .execute()
            .data
            or []
        )
        hydro_map = {str(row.get("id")): row for row in hydro}
        for row in evaluation_rows:
            hydro_row = hydro_map.get(str(row.get("hydro_reading_id")))
            if not hydro_row:
                continue
            evaluations.append(
                {
                    **row,
                    "station_name": hydro_row.get("station_name"),
                    "station_code": hydro_row.get("station_code"),
                    "river_name": hydro_row.get("river_name"),
                }
            )
            if len(evaluations) >= limit:
                break
    except Exception as exc:
        source_errors.append({"source": "evaluations", "message": _safe_error(exc)})

    latest_values = [
        _latest_timestamp(hydro, "observed_at", "created_at"),
        _latest_timestamp(sensors, "observed_at", "created_at"),
        _latest_timestamp(community, "submitted_at", "created_at"),
        _latest_timestamp(evaluations, "evaluated_at", "created_at"),
    ]
    latest_values = [value for value in latest_values if value]

    return {
        "river": basin,
        "counts": {
            "hydro": len(hydro),
            "sensors": len(sensors),
            "community": len(community),
            "evaluations": len(evaluations),
        },
        "latest_received_at": max(latest_values) if latest_values else None,
        "hydro": hydro,
        "sensors": sensors,
        "community": community,
        "evaluations": evaluations,
        "source_errors": source_errors,
    }

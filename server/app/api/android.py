from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/android", tags=["Android"])

STATION_CODES = {
    "TEESTA": "CWC_MELLI",
    "DESANG": "CWC_NANGLAMORAGHAT",
}


@router.get("/overview")
async def overview(river_code: str | None = None):
    """
    Small read-only SENTINEL-X payload for the Android app.

    Android talks to FastAPI only.
    FastAPI talks to Supabase using the server-side client.
    Authentication/role scoping will be added later.
    """

    normalized = river_code.upper().strip() if river_code else None

    if normalized and normalized not in STATION_CODES:
        raise HTTPException(
            status_code=400,
            detail="river_code must be TEESTA or DESANG",
        )

    station_codes = (
        [STATION_CODES[normalized]]
        if normalized
        else list(STATION_CODES.values())
    )

    admin = get_admin_client()

    stations = (
        admin.table("hydro_stations")
        .select(
            "id,station_code,station_name,river_name,district,state,"
            "latitude,longitude,warning_level_m,danger_level_m,"
            "highest_flood_level_m"
        )
        .in_("station_code", station_codes)
        .execute()
        .data
        or []
    )

    # Postgres does not guarantee row order for IN(...). Sort explicitly so the
    # station list order matches `station_codes`, because the app renders
    # stations.firstOrNull(). Without this the displayed station could flip
    # between runs while the evaluation stayed pinned to one river.
    station_by_code = {str(s.get("station_code")): s for s in stations}
    stations = [
        station_by_code[code]
        for code in station_codes
        if code in station_by_code
    ]

    station_payload = []
    displayed_station_reading_id: str | None = None

    for index, station in enumerate(stations):
        readings = (
            admin.table("hydro_readings")
            .select(
                "id,observed_at,water_level_m,"
                "water_level_rate_m_hr,data_mode"
            )
            .eq("station_id", station["id"])
            .order("observed_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )

        # The Android UI renders stations.firstOrNull(), so the evaluation must
        # belong to that same station. Scoping to every station would still let a
        # sibling river's newer evaluation win.
        if index == 0 and readings:
            displayed_station_reading_id = str(readings[0]["id"])

        station_payload.append(
            {
                "id": station["id"],
                "station_code": station.get("station_code"),
                "station_name": station.get("station_name"),
                "river_name": station.get("river_name"),
                "district": station.get("district"),
                "state": station.get("state"),
                "latitude": station.get("latitude"),
                "longitude": station.get("longitude"),
                "warning_level_m": station.get("warning_level_m"),
                "danger_level_m": station.get("danger_level_m"),
                "highest_flood_level_m": station.get(
                    "highest_flood_level_m"
                ),
                "latest_reading": readings[0] if readings else None,
            }
        )

    active_alerts = (
        admin.table("alerts")
        .select(
            "id,alert_code,title,description,instruction,priority,"
            "urgency,severity,certainty,status,created_at,event_id"
        )
        .in_(
            "status",
            ["pending_approval", "approved", "dispatching", "active"],
        )
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )

    # Scope the evaluation to the station(s) this payload actually returns.
    #
    # Previously this took the globally newest rule_evaluation with no station
    # filter. Because the 10s stream alternates Melli <-> Nanglamoraghat, that
    # row belongs to whichever river was evaluated last, so the app could show
    # Melli's water level beside Nanglamoraghat's score. Matching
    # hydro_reading_id against the returned stations' latest readings mirrors
    # how the web dashboard picks an evaluation, so both now agree.
    latest_evaluations: list[dict] = []
    if displayed_station_reading_id:
        latest_evaluations = (
            admin.table("rule_evaluations")
            .select(
                "id,hydro_reading_id,sensor_reading_id,community_report_id,"
                "event_id,engine_version,level_score,rate_score,sensor_score,"
                "community_score,persistence_score,total_score,risk_level,"
                "alert_recommended,alert_priority,reasons,evaluated_at"
            )
            .eq("hydro_reading_id", displayed_station_reading_id)
            .order("evaluated_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )

    return {
        "source": "sentinel-x-fastapi",
        "river_code": normalized,
        "stations": station_payload,
        "active_alerts": active_alerts,
        "latest_evaluation": (
            latest_evaluations[0]
            if latest_evaluations
            else None
        ),
    }

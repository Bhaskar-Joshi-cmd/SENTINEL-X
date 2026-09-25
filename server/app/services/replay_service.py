from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from uuid import UUID

import asyncio
from uuid import UUID

from app.db.supabase import get_admin_client
from app.services.impact_engine import build_impact_assessment
from app.services.rule_engine import evaluate_hydro_reading, get_station_evidence


async def replay_river(river_code: str, station_code: str | None, limit: int, delay_seconds: float) -> dict:
    admin = get_admin_client()

    basin = (
        admin.table("basins")
        .select("id,basin_code,basin_name,river_system")
        .eq("basin_code", river_code.upper())
        .single()
        .execute()
        .data
    )
    if not basin:
        raise ValueError("River/basin not found")

    if station_code:
        clean_station_code = station_code.strip().casefold()

    # Get all stations belonging to the requested basin.
    # We compare station codes in Python so whitespace/case differences
    # in the database cannot prevent a match.
        basin_stations = (
        admin.table("hydro_stations")
        .select("*")
        .eq("basin_id", basin["id"])
        .order("station_name")
        .execute()
        .data
        or []
        )

        station = next(
        (
            s
            for s in basin_stations
            if str(s.get("station_code", "")).strip().casefold()
            == clean_station_code
        ),
        None,
        )

        if station is None:
            available = [
            str(s.get("station_code", "")).strip()
            for s in basin_stations
            ]
            raise ValueError(
            f"Station '{station_code}' not found in river "
            f"'{river_code.upper()}'. Available stations: {available}"
            )

    else:
        stations = (
        admin.table("hydro_stations")
        .select("*")
        .eq("basin_id", basin["id"])
        .order("station_name")
        .limit(1)
        .execute()
        .data
        or []
        )

        if not stations:
            raise ValueError("No hydro station found for this river")

        station = stations[0]

    readings = (
        admin.table("hydro_readings")
        .select("*")
        .eq("station_id", station["id"])
        .eq("data_mode", "historical")
        .order("observed_at")
        .limit(limit)
        .execute()
        .data
        or []
    )
    if not readings:
        raise ValueError("No historical readings available for this station")

    results = []
    first_alert = None
    for reading in readings:
        result = evaluate_hydro_reading(reading, create_alert=True)
        results.append({
            "reading_id": reading["id"],
            "observed_at": reading["observed_at"],
            "water_level_m": reading.get("water_level_m"),
            "rate_m_hr": reading.get("water_level_rate_m_hr"),
            "score": result["total_score"],
            "risk_level": result["risk_level"],
            "alert_recommended": result["alert_recommended"],
            "alert_id": (result.get("alert") or {}).get("id"),
            "reasons": result["reasons"],
        })
        if result.get("alert") and not first_alert:
            first_alert = result["alert"]
            await build_impact_assessment(UUID(result["event"]["id"]))
        if delay_seconds and reading is not readings[-1]:
            await asyncio.sleep(delay_seconds)

    return {
        "river": basin,
        "station": station,
        "mode": "historical_replay",
        "delay_seconds": delay_seconds,
        "steps": results,
        "alert": first_alert,
        "note": "Historical observations are replayed for demonstration; they are not live CWC readings.",
    }


async def replay_reading_step(
    river_code: str,
    station_code: str,
    reading_id: UUID,
) -> dict:
    """
    Evaluate one existing historical hydro reading through the
    same SENTINEL-X rule engine used by normal ingestion.
    """

    admin = get_admin_client()

    basin = (
        admin.table("basins")
        .select("id,basin_code,basin_name,river_system")
        .eq("basin_code", river_code.upper())
        .single()
        .execute()
        .data
    )

    if not basin:
        raise ValueError("River/basin not found")

    station_rows = (
        admin.table("hydro_stations")
        .select("*")
        .eq("basin_id", basin["id"])
        .eq("station_code", station_code)
        .limit(1)
        .execute()
        .data
        or []
    )

    if not station_rows:
        raise ValueError(
            f"Station '{station_code}' not found in "
            f"river '{river_code.upper()}'"
        )

    station = station_rows[0]

    reading_rows = (
        admin.table("hydro_readings")
        .select("*")
        .eq("id", str(reading_id))
        .eq("station_id", station["id"])
        .limit(1)
        .execute()
        .data
        or []
    )

    if not reading_rows:
        raise ValueError(
            "Historical reading not found for this station"
        )

    reading = reading_rows[0]

    if str(reading.get("data_mode") or "historical").lower() != "historical":
        raise ValueError(
            "Replay step requires a historical hydro reading"
        )

    # This is the important part:
    # use the existing rule engine rather than another scoring algorithm.
    # Replay now feeds the latest sensor + community evidence exactly like
    # live ingestion (sensor_reading + community_report args); when evidence
    # is absent the engine scores that factor as 0 (unchanged behavior).
    sensor_reading, community_report = get_station_evidence(station)
    result = evaluate_hydro_reading(
        reading,
        sensor_reading=sensor_reading,
        community_report=community_report,
        create_alert=True,
    )

    event_id = (result.get("event") or {}).get("id")

    # Always compute an impact preview for the replayed observation, using the
    # actual reading/station/score as context. When an event exists the rows are
    # also persisted to impact_assessments; otherwise this is returned so the
    # UI (e.g. Melli, which may have no alert yet) still shows live risk/ETA.
    impact_assessments = await build_impact_assessment(
        UUID(event_id) if event_id else None,
        context={
            "basin_id": basin["id"],
            "station": station,
            "reading": reading,
            "event": result.get("event"),
            "total_score": result["total_score"],
        },
    )

    return {
        "river": basin,
        "station": station,
        "reading": reading,
        "evaluation": result["evaluation"],
        "risk_level": result["risk_level"],
        "total_score": result["total_score"],
        "alert_recommended": result["alert_recommended"],
        "alert_priority": result["alert_priority"],
        "reasons": result["reasons"],
        "alert": result.get("alert"),
        "evidence": {
            "sensor": bool(sensor_reading),
            "community": bool(community_report),
        },
        "impact_assessments": impact_assessments,
        "mode": "historical_replay",
    }


async def replay_tick() -> dict:
    """One automatic streaming tick across every station in every basin.

    Each station keeps an independent cursor derived from its latest stored
    rule evaluation (no in-memory state, no locks): the next chronological
    historical reading is evaluated through the SAME rule engine used by
    live ingestion, the village impact preview is rebuilt, and the cursor
    wraps back to the oldest row after the newest so the stream never stops.
    Row counts never have to match between stations — every station advances
    on its own.
    """
    admin = get_admin_client()

    tick_at = datetime.now(timezone.utc).isoformat()
    basin_rows = (
        admin.table("basins")
        .select("id,basin_code,basin_name")
        .order("basin_code")
        .execute()
        .data
        or []
    )

    station_results: list[dict] = []
    for basin in basin_rows:
        stations = (
            admin.table("hydro_stations")
            .select("*")
            .eq("basin_id", basin["id"])
            .order("station_name")
            .execute()
            .data
            or []
        )

        for station in stations:
            try:
                readings = (
                    admin.table("hydro_readings")
                    .select("*")
                    .eq("station_id", station["id"])
                    .eq("data_mode", "historical")
                    .order("observed_at")
                    .limit(500)
                    .execute()
                    .data
                    or []
                )
                if not readings:
                    station_results.append({
                        "river_code": basin["basin_code"],
                        "river_name": basin.get("basin_name"),
                        "station_code": station.get("station_code"),
                        "station_name": station.get("station_name"),
                        "error": "No historical readings available for this station",
                    })
                    continue

                # Cursor derived from DB state: the station's latest stored
                # rule evaluation points at the reading that was evaluated
                # last, so the next tick advances one row past it and wraps
                # to the oldest row once the newest has been streamed.
                reading_ids = [str(row["id"]) for row in readings]
                latest_eval = (
                    admin.table("rule_evaluations")
                    .select("hydro_reading_id")
                    .in_("hydro_reading_id", reading_ids)
                    .order("evaluated_at", desc=True)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                if latest_eval and str(latest_eval[0]["hydro_reading_id"]) in reading_ids:
                    last_index = reading_ids.index(str(latest_eval[0]["hydro_reading_id"]))
                    next_index = (last_index + 1) % len(readings)
                else:
                    next_index = 0

                reading = readings[next_index]

                # Same rule engine path as live ingestion — the engine itself
                # pulls the latest sensor + community evidence for this station
                # (get_station_evidence), so missing evidence scores that
                # factor as 0 instead of inventing defaults.
                result = evaluate_hydro_reading(reading, create_alert=True)

                event_id = (result.get("event") or {}).get("id")

                # TODO(delivery): this is the future hook — with the same 10s
                # span, iterate the impact rows below to check each village's
                # score and trigger the message/relay pipeline. Delivery is
                # intentionally NOT wired yet.
                impact_assessments = await build_impact_assessment(
                    UUID(event_id) if event_id else None,
                    context={
                        "basin_id": basin["id"],
                        "station": station,
                        "reading": reading,
                        "event": result.get("event"),
                        "total_score": result["total_score"],
                    },
                )

                station_results.append({
                    "river_code": basin["basin_code"],
                    "river_name": basin.get("basin_name"),
                    "station_code": station["station_code"],
                    "station_name": station["station_name"],
                    "reading": reading,
                    "evaluation": result["evaluation"],
                    "risk_level": result["risk_level"],
                    "total_score": result["total_score"],
                    "alert_recommended": result["alert_recommended"],
                    "alert_priority": result["alert_priority"],
                    "reasons": result["reasons"],
                    "alert": result.get("alert"),
                    "impact_assessments": impact_assessments,
                    "step_index": next_index + 1,
                    "total_steps": len(readings),
                    "mode": "auto_stream",
                })
            except Exception as exc:  # one station failing must not kill the tick
                station_results.append({
                    "river_code": basin["basin_code"],
                    "river_name": basin.get("basin_name"),
                    "station_code": station.get("station_code"),
                    "station_name": station.get("station_name"),
                    "error": str(exc),
                })

    return {
        "tick_at": tick_at,
        "stations": station_results,
    }

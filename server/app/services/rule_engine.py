from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from app.db.supabase import get_admin_client


ALERT_THRESHOLD = 70.0


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _level_score(level: float | None, warning: float | None, danger: float | None, hfl: float | None) -> float:
    if level is None or warning is None or danger is None:
        return 0.0
    if level < warning:
        return 0.0
    if hfl is None or hfl <= danger:
        if level >= danger:
            return 60.0
        fraction = (level - warning) / max(danger - warning, 1e-9)
        return round(20.0 + max(0.0, min(1.0, fraction)) * 40.0, 2)
    if level < danger:
        fraction = (level - warning) / max(danger - warning, 1e-9)
        return round(20.0 + max(0.0, min(1.0, fraction)) * 20.0, 2)
    if level < hfl:
        fraction = (level - danger) / max(hfl - danger, 1e-9)
        return round(40.0 + max(0.0, min(1.0, fraction)) * 20.0, 2)
    return 60.0


def _rate_score(rate_m_hr: float | None) -> float:
    if rate_m_hr is None or rate_m_hr <= 0:
        return 0.0

    if rate_m_hr <= 0.02:
        return 10.0

    return 20.0


def _risk(total: float) -> tuple[str, str, bool]:
    if total < 25:
        return "normal", "P3", False
    if total < 50:
        return "watch", "P3", False
    if total < 70:
        return "warning", "P2", False
    if total < 85:
        return "high", "P1", True
    return "critical", "P0", True


def _hazard_from_report(report_type: str) -> str:
    if report_type in {"flood", "water_rise"}:
        return "flash_flood"
    if report_type == "landslide":
        return "landslide"
    if report_type == "avalanche":
        return "avalanche"
    return "unknown"


# Locked hierarchy amendment: minimal verification vocabulary.
# submitted (+ legacy pending alias), field_confirmed, not_confirmed,
# corroborated, verified, rejected. 'incorporated' is NOT a human state —
# incorporation is represented by event/score/evaluation records.
VALID_EVIDENCE_STATUSES = {
    "submitted",
    "pending",
    "field_confirmed",
    "corroborated",
    "verified",
}

# Community ladder weights (max stays 5/100): first report +1, second
# independent reporter +1, manager field confirmation +2, VA corroboration +1.
COMMUNITY_EVIDENCE_MAX = 5.0

# Safety cap on how many reports one event window may contribute to the
# ladder (mirrors _event_window_reports; applied again after merging an
# explicitly supplied report).
COMMUNITY_WINDOW_REPORT_CAP = 20


def _identity_of(row: dict) -> str | None:
    """Stable reporter identity for independence checks (auth or demo)."""
    reporter = row.get("reporter_user_id")
    if reporter:
        return f"user:{reporter}"
    metadata = row.get("metadata") or {}
    for key in ("reporter_identity", "demo_identity", "submitted_via", "demo_context"):
        value = metadata.get(key)
        if value:
            return f"demo:{value}:{row.get('village_id')}:{row.get('report_type')}"
    return None


def _community_ladder(reports: list[dict]) -> tuple[float, list[str]]:
    """Grade community evidence 0..5 from the current event window.

    Ladder: +1 first valid hazard report (a single isolated report is never
    ignored), +1 second independent reporter, +2 Community Manager field
    confirmation by a third person, +1 Village Authority corroboration.
    The same person never counts twice: a manager confirming their own
    report adds nothing.
    """
    valid = [
        row
        for row in reports
        if str(row.get("report_type") or "") in {"flood", "water_rise", "landslide", "avalanche"}
        and str(row.get("verification_status") or "") in VALID_EVIDENCE_STATUSES
    ]
    if not valid:
        return 0.0, []
    # Newest first so the freshest evidence wins ties.
    valid.sort(key=lambda row: str(row.get("submitted_at") or ""), reverse=True)

    score = 1.0
    reasons = [f"Community evidence: {valid[0].get('report_type')} report ({valid[0].get('verification_status')})"]
    seen: set[str] = set()
    first_identity = _identity_of(valid[0])
    if first_identity:
        seen.add(first_identity)

    # Second independent reporter.
    second = None
    for row in valid[1:]:
        identity = _identity_of(row)
        if identity and identity in seen:
            continue
        second = row
        if identity:
            seen.add(identity)
        break
    if second is not None:
        score += 1.0
        reasons.append("Second independent reporter nearby")

    # Manager field confirmation by someone other than the reporters.
    confirmed = False
    for row in valid:
        if str(row.get("verification_status") or "") != "field_confirmed":
            continue
        metadata = row.get("metadata") or {}
        confirmer = metadata.get("verified_by") or metadata.get("field_verified_by")
        confirmer_key = f"user:{confirmer}" if confirmer else _identity_of(row)
        if confirmer_key and confirmer_key in seen:
            continue
        confirmed = True
        if confirmer_key:
            seen.add(confirmer_key)
        break
    if confirmed:
        score += 2.0
        reasons.append("Community Manager field confirmation")

    # Village Authority corroboration.
    if any(str(row.get("verification_status") or "") == "corroborated" for row in valid):
        score += 1.0
        reasons.append("Village Authority corroboration")

    return round(min(score, COMMUNITY_EVIDENCE_MAX), 2), reasons


def _find_or_create_event(station: dict, hazard_type: str) -> dict:
    admin = get_admin_client()
    basin_id = station.get("basin_id")
    if basin_id:
        existing = (
            admin.table("events")
            .select("*")
            .eq("basin_id", str(basin_id))
            .eq("hazard_type", hazard_type)
            .in_("status", ["monitoring", "active", "confirmed"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            return existing[0]

    event_code = f"AUTO-{station['station_code']}-{hazard_type.upper()}-{uuid4().hex[:8]}"
    payload = {
        "event_code": event_code,
        "hazard_type": hazard_type,
        "title": f"Potential {hazard_type.replace('_', ' ').title()} at {station['station_name']}",
        "description": "Generated by CascadeGuard rule engine",
        "latitude": station.get("latitude"),
        "longitude": station.get("longitude"),
        "basin_id": station.get("basin_id"),
        "first_observed_at": None,
        "last_observed_at": None,
        "confidence_score": 0,
        "confidence_level": "suspected",
        "status": "active",
    }
    response = admin.table("events").insert(payload).select("*").execute()
    if not response.data:
        raise ValueError("Failed to create event")
    return response.data[0]


def _get_station(station_id: UUID | str) -> dict:
    admin = get_admin_client()
    response = (
        admin.table("hydro_stations")
        .select("*")
        .eq("id", str(station_id))
        .single()
        .execute()
    )
    if not response.data:
        raise ValueError("Station not found")
    return response.data


def _get_previous_hydro_rows(
    station_id: UUID | str,
    current_observed_at: str | None = None
) -> list[dict]:
    admin = get_admin_client()

    query = (
        admin.table("hydro_readings")
        .select("id,observed_at,water_level_m")
        .eq("station_id", str(station_id))
    )

    # Only consider readings that happened before the current reading.
    if current_observed_at:
        query = query.lt("observed_at", current_observed_at)

    rows = (
        query
        .order("observed_at", desc=True)
        .limit(2)
        .execute()
        .data
        or []
    )

    return rows


def _get_recent_confirming_sensor(station_id: UUID | str) -> dict | None:
    admin = get_admin_client()
    rows = (
        admin.table("sensor_readings")
        .select("*")
        .order("observed_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )
    # Prototype association: station-specific linkage is supplied by the ingestion route
    # through metadata when the current sensor is the one being evaluated.
    for row in rows:
        metadata = row.get("raw_data") or {}
        if str(metadata.get("station_id")) == str(station_id):
            return row
    return None


def _get_recent_community_report(station_id: UUID | str) -> dict | None:
    admin = get_admin_client()
    rows = (
        admin.table("community_reports")
        .select("*")
        .eq("station_id", str(station_id))
        .order("submitted_at", desc=True)
        .limit(5)
        .execute()
        .data
        or []
    )
    for row in rows:
        if row.get("verification_status") in {"pending", "verified"}:
            return row
    return None


def get_station_evidence(station: dict) -> tuple[dict | None, dict | None]:
    """Latest sensor + community evidence for a station (replay/live parity).

    Returns (sensor_reading, community_report); either may be None when no
    evidence exists, in which case the engine scores that factor as 0
    (existing engine behavior — no defaults are invented).

    Community reports carry village_id (no station_id column), so they are
    linked through villages in the station's basin.
    """
    admin = get_admin_client()
    station_id = station.get("id")

    sensor: dict | None = _get_recent_confirming_sensor(station_id)
    if sensor:
        sensor_type = None
        sensor_id = sensor.get("sensor_id")
        if sensor_id:
            device_rows = (
                admin.table("sensor_devices")
                .select("sensor_type")
                .eq("id", str(sensor_id))
                .limit(1)
                .execute()
                .data
                or []
            )
            if device_rows:
                sensor_type = device_rows[0].get("sensor_type")
        sensor = dict(sensor)
        sensor["sensor_type"] = sensor_type
        raw = dict(sensor.get("raw_data") or {})
        raw["station_id"] = str(station_id)
        raw["sensor_code"] = raw.get("sensor_code", sensor.get("sensor_code"))
        sensor["raw_data"] = raw

    community: dict | None = None
    basin_id = station.get("basin_id")
    if basin_id:
        villages = (
            admin.table("villages")
            .select("id")
            .eq("basin_id", str(basin_id))
            .execute()
            .data
            or []
        )
        village_ids = [str(v["id"]) for v in villages if v.get("id")]
        if village_ids:
            rows = (
                admin.table("community_reports")
                .select("*")
                .in_("village_id", village_ids)
                .order("submitted_at", desc=True)
                .limit(5)
                .execute()
                .data
                or []
            )
            for row in rows:
                status = str(row.get("verification_status") or "submitted").lower()
                if status in VALID_EVIDENCE_STATUSES:
                    community = row
                    break

    return sensor, community


# Community evidence stays valid for the whole event window, not just the
# slice between two evaluations. Without this, a report dropped out of scope
# on the very next 10 s tick and field confirmation could never be counted.
COMMUNITY_WINDOW_HOURS = 6


def _event_window_start(admin, station: dict) -> str | None:
    """Start of the current community evidence window for this station's basin.

    Prefers the live hazard event (its ``created_at``), so graded community
    evidence accumulates across the 10 s replay/live evaluation stream while
    still being bounded to the current event. Falls back to a rolling window
    when no event row exists yet.
    """
    basin_id = station.get("basin_id")
    if basin_id:
        try:
            rows = (
                admin.table("events")
                .select("created_at,status")
                .eq("basin_id", str(basin_id))
                .in_("status", ["monitoring", "active", "confirmed"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
                .data
                or []
            )
            if rows and rows[0].get("created_at"):
                return str(rows[0]["created_at"])
        except Exception:
            pass
    return (datetime.now(timezone.utc) - timedelta(hours=COMMUNITY_WINDOW_HOURS)).isoformat()


def _event_window_reports(admin, station: dict, hydro: dict, limit: int = 20) -> list[dict]:
    """Reports scoped to the current event window (safety-capped at 20).

    The window start comes from the active hazard event for this basin, so a
    report keeps contributing when the Community Manager confirms it or the
    Village Authority corroborates it on a later tick. Village-scoped reports
    with no station still count when the village belongs to this station's
    basin (landslide/road-block case).
    """
    station_id = str(station.get("id"))
    basin_id = station.get("basin_id")
    window_start = _event_window_start(admin, station)
    try:
        query = (
            admin.table("community_reports")
            .select("*")
            .order("submitted_at", desc=True)
            .limit(limit * 3)
        )
        if window_start:
            query = query.gte("submitted_at", window_start)
        rows = query.execute().data or []
    except Exception:
        return []
    basin_villages: set[str] | None = None
    if basin_id:
        try:
            villages = (
                admin.table("villages")
                .select("id")
                .eq("basin_id", str(basin_id))
                .execute()
                .data
                or []
            )
            basin_villages = {str(v.get("id")) for v in villages if v.get("id")}
        except Exception:
            basin_villages = None
    scoped: list[dict] = []
    for row in rows:
        if str(row.get("station_id") or "") == station_id:
            scoped.append(row)
        elif not row.get("station_id") and basin_villages is not None and str(row.get("village_id") or "") in basin_villages:
            scoped.append(row)
        if len(scoped) >= limit:
            break
    return scoped


def evaluate_hydro_reading(
    hydro_reading: dict,
    sensor_reading: dict | None = None,
    community_report: dict | None = None,
    create_alert: bool = True,
) -> dict:
    station = _get_station(hydro_reading["station_id"])

    # Replay/live parity: when the caller does not pass explicit sensor or
    # community evidence, pull the latest rows recorded for this station so
    # every evaluation (including historical replay) scores the same factors.
    # Missing evidence returns None and simply scores that factor as 0 —
    # no defaults are invented.
    if sensor_reading is None or community_report is None:
        db_sensor, db_community = get_station_evidence(station)
        if sensor_reading is None:
            sensor_reading = db_sensor
        if community_report is None:
            community_report = db_community

    level = _safe_float(hydro_reading.get("water_level_m"))
    rate = _safe_float(hydro_reading.get("water_level_rate_m_hr"))

    level_score = _level_score(
        level,
        _safe_float(station.get("warning_level_m")),
        _safe_float(station.get("danger_level_m")),
        _safe_float(station.get("highest_flood_level_m")),
    )
    rate_score = _rate_score(rate)

    sensor_score = 0.0
    if sensor_reading:
        sensor_type = sensor_reading.get("sensor_type")
        sensor_value = _safe_float(sensor_reading.get("numeric_value"))
        if sensor_type == "water_level" and sensor_value is not None:
            warning = _safe_float(station.get("warning_level_m"))
            if warning is not None and sensor_value >= warning:
                sensor_score = 10.0
        elif sensor_type in {"seismic", "vibration", "camera"}:
            sensor_score = 5.0

    community_score = 0.0
    community_reasons: list[str] = []
    community_window_size = 0

    # --- Community evidence -------------------------------------------
    # Graded ladder over the current event window (max 5/100). A single
    # isolated report still counts (+1) so an isolated village is never
    # ignored; rejected / not_confirmed rows are skipped. An explicitly
    # supplied report is merged into the window so the submit-time score and
    # the 10 s tick score always agree.
    window_reports = _event_window_reports(get_admin_client(), station, hydro_reading)
    if community_report is not None:
        known_ids = {str(row.get("id")) for row in window_reports}
        if str(community_report.get("id")) not in known_ids:
            window_reports = [community_report, *window_reports]
    window_reports = window_reports[:COMMUNITY_WINDOW_REPORT_CAP]
    community_score, community_reasons = _community_ladder(window_reports)
    community_window_size = len(window_reports)

    previous = _get_previous_hydro_rows(
    hydro_reading["station_id"],
    hydro_reading.get("observed_at")
)
    warning = _safe_float(station.get("warning_level_m"))
    persistence_score = 5.0 if warning is not None and len(previous) >= 2 and all(
        _safe_float(row.get("water_level_m")) is not None and _safe_float(row.get("water_level_m")) >= warning
        for row in previous[:2]
    ) else 0.0

    total = min(100.0, round(level_score + rate_score + sensor_score + community_score + persistence_score, 2))
    risk_level, priority, alert_recommended = _risk(total)

    reasons: list[str] = []
    # Community ladder notes are produced before the hydro/sensor scores are
    # assembled, so they are merged in here (never before `reasons` exists).
    reasons.extend(community_reasons)
    if level_score > 0:
        reasons.append(f"River level contributes {level_score:.1f}/60")
    if rate_score > 0:
        reasons.append(f"Rate of rise contributes {rate_score:.1f}/20")
    if sensor_score > 0:
        reasons.append(f"Sensor confirmation contributes {sensor_score:.1f}/10")
    if community_score > 0:
        reasons.append(f"Community evidence contributes {community_score:.1f}/5")
    if persistence_score > 0:
        reasons.append("Consecutive abnormal readings add persistence evidence")
    if not reasons:
        reasons.append("No abnormal evidence crossed the scoring rules")

    event = None
    if total >= 50:
        event = _find_or_create_event(station, "flash_flood")

        admin = get_admin_client()
        update_payload = {
            "last_observed_at": hydro_reading.get("observed_at"),
            "confidence_score": total,
            "confidence_level": "confirmed" if total >= 70 else "probable",
            "status": "confirmed" if total >= 70 else "active",
            "updated_at": hydro_reading.get("observed_at"),
        }
        admin.table("events").update(update_payload).eq("id", event["id"]).execute()

        evidence = {
            "event_id": event["id"],
            "source_id": station.get("source_id"),
            "feed_ingestion_id": None,
            "observation_type": "river_level",
            "is_supporting_evidence": True,
        }
        admin.table("event_observations").insert(evidence).execute()

    evaluation_payload = {
        "hydro_reading_id": hydro_reading.get("id"),
        "sensor_reading_id": (sensor_reading or {}).get("id"),
        "community_report_id": (community_report or {}).get("id"),
        "event_id": event.get("id") if event else None,
        "engine_version": "v1.0",
        "level_score": level_score,
        "rate_score": rate_score,
        "sensor_score": sensor_score,
        "community_score": community_score,
        "persistence_score": persistence_score,
        "total_score": total,
        "risk_level": risk_level,
        "alert_recommended": alert_recommended,
        "alert_priority": priority,
        "reasons": reasons,
        "input_snapshot": {
            "station": station,
            "hydro_reading": hydro_reading,
            "sensor_reading": sensor_reading,
            "community_report": community_report,
            "community_window_size": community_window_size,
        },
    }
    evaluation_response = (
        get_admin_client()
        .table("rule_evaluations")
        .insert(evaluation_payload)
        .select("*")
        .execute()
    )
    if not evaluation_response.data:
        raise ValueError("Failed to create rule evaluation")
    evaluation = evaluation_response.data[0]

    alert = None
    if alert_recommended and create_alert and event:
        alert = _create_pending_alert(event, station, evaluation, priority)

    return {
        "evaluation": evaluation,
        "event": event,
        "alert": alert,
        "risk_level": risk_level,
        "total_score": total,
        "alert_recommended": alert_recommended,
        "alert_priority": priority,
        "reasons": reasons,
    }


def evaluate_sensor_reading(
    sensor_reading: dict,
    station_id: UUID | str,
) -> dict:
    admin = get_admin_client()

    # Get the latest historical hydro reading for the station.
    hydro_rows = (
        admin.table("hydro_readings")
        .select("*")
        .eq("station_id", str(station_id))
        .order("observed_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )

    if not hydro_rows:
        # Create evaluation context only.
        # This synthetic row is NOT inserted into hydro_readings.
        hydro = {
            "id": None,
            "station_id": str(station_id),
            "observed_at": None,
            "water_level_m": None,
            "water_level_rate_m_hr": None,
            "data_mode": "live",
        }
    else:
        hydro = hydro_rows[0]

    # sensor_readings stores sensor_id, while sensor_type
    # is stored in sensor_devices.
    sensor_type = None

    sensor_id = sensor_reading.get("sensor_id")

    if sensor_id:
        device_rows = (
            admin.table("sensor_devices")
            .select("sensor_type")
            .eq("id", str(sensor_id))
            .limit(1)
            .execute()
            .data
            or []
        )

        if device_rows:
            sensor_type = device_rows[0].get("sensor_type")

    # Copy the sensor reading and add the sensor type
    # so evaluate_hydro_reading() can apply the correct rule.
    sensor_copy = dict(sensor_reading)
    sensor_copy["sensor_type"] = sensor_type

    raw = dict(sensor_copy.get("raw_data") or {})
    raw["station_id"] = str(station_id)
    raw["sensor_code"] = raw.get(
        "sensor_code",
        sensor_copy.get("sensor_code"),
    )

    sensor_copy["raw_data"] = raw

    return evaluate_hydro_reading(
        hydro,
        sensor_reading=sensor_copy,
    )


def _station_for_village(admin, village_id: str | None) -> str | None:
    """First station of the village's basin (fallback for station-less reports).

    Landslide / road-block reports intentionally carry no station, but they
    still need a hydro context before they can be scored.
    """
    if not village_id:
        return None
    try:
        village_rows = (
            admin.table("villages")
            .select("basin_id")
            .eq("id", str(village_id))
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception:
        return None
    basin_id = village_rows[0].get("basin_id") if village_rows else None
    if not basin_id:
        return None
    try:
        station_rows = (
            admin.table("hydro_stations")
            .select("id")
            .eq("basin_id", str(basin_id))
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception:
        return None
    return str(station_rows[0]["id"]) if station_rows else None


def evaluate_community_report(report: dict) -> dict:
    admin = get_admin_client()
    station_id = report.get("station_id") or _station_for_village(admin, report.get("village_id"))
    if not station_id:
        # Stored, but there is no station context to score it against.
        return {
            "evaluated": False,
            "report_id": report.get("id"),
            "reason": "No station could be linked to this report; stored without a rule evaluation.",
        }
    hydro_rows = (
        admin.table("hydro_readings")
        .select("*")
        .eq("station_id", str(station_id))
        .order("observed_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    hydro = hydro_rows[0] if hydro_rows else {
        "id": None,
        "station_id": str(station_id),
        "observed_at": None,
        "water_level_m": None,
        "water_level_rate_m_hr": None,
        "data_mode": "live",
    }
    return evaluate_hydro_reading(hydro, community_report=report)


def _create_pending_alert(event: dict, station: dict, evaluation: dict, priority: str) -> dict:
    admin = get_admin_client()
    existing = (
        admin.table("alerts")
        .select("*")
        .eq("event_id", event["id"])
        .in_("status", ["draft", "pending_approval", "approved", "dispatching", "active"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        return existing[0]

    score = _safe_float(evaluation.get("total_score")) or 0
    payload = {
        "alert_code": f"CG-{station['station_code']}-{evaluation['id'][:8]}",
        "event_id": event["id"],
        "cap_identifier": f"cascadeguard-{evaluation['id']}",
        "message_type": "Alert",
        "scope": "restricted",
        "hazard_type": event.get("hazard_type"),
        "title": f"CascadeGuard warning — {station['river_name']}",
        "description": f"Rule engine confidence score: {score:.1f}/100 at {station['station_name']}",
        "instruction": "Follow local disaster-management instructions and move toward the designated safe area if directed.",
        "priority": priority,
        "urgency": "Immediate" if priority in {"P0", "P1"} else "Expected",
        "severity": "Extreme" if priority == "P0" else "Severe" if priority == "P1" else "Moderate",
        "certainty": "Observed",
        "status": "pending_approval",
        "cap_payload": {"prototype": True, "generated_by": "rule_engine", "evaluation_id": evaluation["id"]},
    }
    response = admin.table("alerts").insert(payload).select("*").execute()
    if not response.data:
        raise ValueError("Failed to create alert")
    return response.data[0]

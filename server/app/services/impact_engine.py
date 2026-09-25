from __future__ import annotations

from uuid import UUID

from app.db.supabase import get_admin_client


def _safe_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _risk_level(risk: float) -> str:
    """Map a 0-100 risk score to a risk level.

    Only critical/high are written to the DB (the impact_assessments CHECK
    constraint rejects anything else); lower bands are still returned by the
    live preview path below via _preview_level.
    """
    if risk >= 80:
        return "critical"
    return "high"


def _preview_level(risk: float) -> str:
    """Full risk vocabulary used only for live (non-persisted) previews."""
    if risk >= 80:
        return "critical"
    if risk >= 65:
        return "high"
    if risk >= 50:
        return "moderate"
    return "low"


def _hazard_intensity(event: dict | None) -> float:
    """0..1 multiplier from the event confidence when an event exists."""
    if not event:
        return 0.5
    score = _safe_float(event.get("confidence_score"))
    if score is None:
        return 0.5
    return max(0.0, min(1.0, score / 100.0))


async def build_impact_assessment(event_id: UUID | None = None, context: dict | None = None) -> list[dict]:
    """Compute village impact for an event, or on-the-fly from replay context.

    Previously this used a purely static formula (risk = 92 - index*9,
    eta = 15 + index*15) so village scores never changed. Risk is now derived
    from the actual rule-engine hazard intensity, the village vulnerability and
    downstream distance, and ETA from the observed rise rate against the
    head-room to the station's danger level.
    """
    admin = get_admin_client()

    event = None
    station = None
    reading = None
    total_score = None

    if event_id is not None:
        event = admin.table("events").select("*").eq("id", str(event_id)).single().execute().data
        if not event:
            return []
        if not event.get("basin_id"):
            return []

        # Most recent evaluation for this event carries the live hazard score.
        eval_rows = (
            admin.table("rule_evaluations")
            .select("total_score,input_snapshot")
            .eq("event_id", str(event_id))
            .order("evaluated_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if eval_rows:
            total_score = _safe_float(eval_rows[0].get("total_score"))
            snapshot = eval_rows[0].get("input_snapshot") or {}
            if isinstance(snapshot, dict):
                station = snapshot.get("station") or None
                reading = snapshot.get("hydro_reading") or None

    if context:
        station = context.get("station") or station
        reading = context.get("reading") or reading
        total_score = _safe_float(context.get("total_score")) or total_score
        if context.get("event") and not event:
            event = context["event"]

    if not event and not (context and context.get("station")):
        return []

    station = station or {}
    reading = reading or {}

    basin_id = (
        (context or {}).get("basin_id")
        or (event or {}).get("basin_id")
        or station.get("basin_id")
    )
    if not basin_id:
        return []

    villages = (
        admin.table("villages")
        .select("id,village_name,population,vulnerability_score,latitude,longitude")
        .eq("basin_id", basin_id)
        .order("vulnerability_score", desc=True)
        .execute()
        .data
        or []
    )

    # --- Hazard dynamics -----------------------------------------------------
    hazard_intensity = _hazard_intensity(event) if event else max(0.0, min(1.0, (total_score or 0) / 100.0))
    if hazard_intensity <= 0:
        hazard_intensity = max(0.0, min(1.0, (total_score or 0) / 100.0))

    level = _safe_float(reading.get("water_level_m"))
    rate = _safe_float(reading.get("water_level_rate_m_hr"))
    warning = _safe_float(station.get("warning_level_m"))
    danger = _safe_float(station.get("danger_level_m"))
    hfl = _safe_float(station.get("highest_flood_level_m"))

    # Head-room above the current level defines how fast the hazard can spread.
    if level is not None and warning is not None:
        warning_gap = max(0.0, level - warning)
    else:
        warning_gap = None

    target_level = hfl or danger
    # Time for the river to reach the danger/HFL band at the observed rise
    # rate. rate is in m/hour, so head-room (m) / rate (m/hr) = hours -> min.
    if level is not None and rate is not None and rate > 0.005 and target_level is not None:
        base_eta = max(0.0, (target_level - level) / rate) * 60.0  # minutes
    else:
        base_eta = None

    # Fallback pacing when no usable rate/level: gentle downstream cascade.
    eta_pace_minutes = 12.0

    assessments = []
    for index, village in enumerate(villages):
        vulnerability = _safe_float(village.get("vulnerability_score"))
        vulnerability = vulnerability if vulnerability is not None else 0.5

        # Downstream distance proxy: later villages are further away.
        distance_factor = index / max(len(villages) - 1, 1)

        # --- Dynamic risk score -----------------------------------------
        # Base hazard (up to 70) scales with the rule-engine score, attenuated
        # downstream; vulnerability contributes up to 25; proximity adds up to 5.
        base = 70.0 * hazard_intensity * (1.0 - 0.35 * distance_factor)
        vuln_component = 25.0 * max(0.0, min(1.0, vulnerability))
        proximity = 5.0 * (1.0 - distance_factor)
        risk = base + vuln_component + proximity
        risk = round(max(0.0, min(100.0, risk)), 2)

        risk_level = _risk_level(risk) if event_id is not None else _preview_level(risk)

        # --- Dynamic ETA --------------------------------------------------
        # Villages further downstream are hit later; each also absorbs part of
        # the surge so ETA grows with distance, anchored on the observed rate.
        if base_eta is not None:
            eta = base_eta + distance_factor * max(20.0, base_eta * 0.8)
        elif warning_gap is not None:
            eta = eta_pace_minutes * (1 + distance_factor * 2) + (eta_pace_minutes if hazard_intensity < 0.5 else 0)
        else:
            eta = eta_pace_minutes * (1 + distance_factor * 2)

        row = {
            "village_id": village["id"],
            "risk_score": risk,
            "risk_level": risk_level,
            "time_to_impact_minutes": round(max(1.0, eta), 2),
            "hazard_path_distance_km": None,
            "downstream_order": index + 1,
            "population_at_risk": village.get("population"),
            "calculation_method": "rule_engine_dynamic_v1",
            "model_version": "demo-v2",
            "details": {
                "prototype": True,
                "rule_engine_score": total_score,
                "hazard_intensity": round(hazard_intensity, 4),
                "observed_level_m": level,
                "observed_rate_m_hr": rate,
                "vulnerability": vulnerability,
                "downstream_distance_factor": round(distance_factor, 4),
                "note": "Dynamic model: rule-engine score + vulnerability + downstream attenuation; ETA from observed rise rate.",
            },
        }

        assessments.append(row)

    if event_id is not None:
        for row in assessments:
            row["event_id"] = str(event_id)
            existing = (
                admin.table("impact_assessments")
                .select("id")
                .eq("event_id", str(event_id))
                .eq("village_id", row["village_id"])
                .limit(1)
                .execute()
                .data
                or []
            )
            if existing:
                admin.table("impact_assessments").update(row).eq("id", existing[0]["id"]).execute()
            else:
                admin.table("impact_assessments").insert(row).execute()

    return assessments
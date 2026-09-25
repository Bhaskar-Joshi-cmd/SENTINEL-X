from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import get_admin_client
from app.schemas import CommunityReportCreate
from app.services.rule_engine import evaluate_community_report

router = APIRouter(prefix="/village-authority", tags=["Village Authority"])
ACTIVE_ALERT_STATUSES = ["pending_approval", "approved", "dispatching", "active"]


def _one(table: str, filters: dict, columns: str) -> dict | None:
    query = get_admin_client().table(table).select(columns)
    for key, value in filters.items():
        query = query.eq(key, str(value))
    rows = query.limit(1).execute().data or []
    return rows[0] if rows else None


def _village(village_id: UUID | str) -> dict:
    row = _one(
        "villages",
        {"id": village_id},
        "id,village_code,village_name,district,state,latitude,longitude,population,vulnerability_score,internet_available,cellular_available,basin_id",
    )
    if not row:
        raise HTTPException(404, "Village not found")
    return row


def _station(basin_id: UUID | str) -> dict | None:
    rows = (
        get_admin_client().table("hydro_stations")
        .select("id,station_code,station_name,river_name,district,state,latitude,longitude,warning_level_m,danger_level_m,highest_flood_level_m")
        .eq("basin_id", str(basin_id)).order("station_name").limit(1).execute().data or []
    )
    return rows[0] if rows else None


def _latest_reading(station_id: str | None) -> dict | None:
    if not station_id:
        return None
    rows = (
        get_admin_client().table("hydro_readings")
        .select("id,station_id,observed_at,water_level_m,water_level_rate_m_hr,data_mode")
        .eq("station_id", station_id).order("observed_at", desc=True).limit(1).execute().data or []
    )
    return rows[0] if rows else None


def _latest_evaluation(station_id: str | None, reading_id: str | None) -> dict | None:
    admin = get_admin_client()
    columns = (
        "id,hydro_reading_id,event_id,total_score,level_score,rate_score,sensor_score,"
        "community_score,persistence_score,engine_version,risk_level,alert_recommended,"
        "alert_priority,reasons,evaluated_at"
    )
    if reading_id:
        rows = admin.table("rule_evaluations").select(columns).eq("hydro_reading_id", reading_id).order("evaluated_at", desc=True).limit(1).execute().data or []
        if rows:
            return rows[0]
    if not station_id:
        return None
    reading_rows = admin.table("hydro_readings").select("id").eq("station_id", station_id).order("observed_at", desc=True).limit(10).execute().data or []
    ids = [str(row["id"]) for row in reading_rows if row.get("id")]
    if not ids:
        return None
    rows = admin.table("rule_evaluations").select(columns).in_("hydro_reading_id", ids).order("evaluated_at", desc=True).limit(1).execute().data or []
    return rows[0] if rows else None


@router.get("/summary")
def summary(village_id: UUID = Query(...), report_limit: int = Query(default=12, ge=1, le=50)):
    """Demo-compatible village-scoped summary. Auth will later supply village_id server-side."""
    admin = get_admin_client()
    village = _village(village_id)
    basin = _one("basins", {"id": village["basin_id"]}, "id,basin_code,basin_name,river_system")
    if not basin:
        raise HTTPException(404, "Village basin not found")
    station = _station(village["basin_id"])
    reading = _latest_reading(str(station["id"]) if station else None)
    evaluation = _latest_evaluation(str(station["id"]) if station else None, str(reading["id"]) if reading else None)

    targets = (
        admin.table("alert_targets")
        .select("alert_id,target_status,risk_score,time_to_impact_minutes,target_priority")
        .eq("village_id", str(village_id)).order("created_at", desc=True).limit(20).execute().data or []
    )
    alert = None
    target = None
    impact = None
    alert_ids = [row["alert_id"] for row in targets if row.get("alert_id")]
    if alert_ids:
        alerts = (
            admin.table("alerts").select("*").in_("id", alert_ids)
            .in_("status", ACTIVE_ALERT_STATUSES).order("created_at", desc=True).limit(20).execute().data or []
        )
        if alerts:
            alert = alerts[0]
            target = next((row for row in targets if str(row.get("alert_id")) == str(alert["id"])), None)
            if alert.get("event_id"):
                impacts = (
                    admin.table("impact_assessments")
                    .select("event_id,village_id,risk_score,risk_level,time_to_impact_minutes,hazard_path_distance_km,downstream_order,population_at_risk,calculation_method,model_version")
                    .eq("event_id", str(alert["event_id"])).eq("village_id", str(village_id)).limit(1).execute().data or []
                )
                impact = impacts[0] if impacts else None

    deliveries = (
        admin.table("alert_deliveries").select("*").eq("village_id", str(village_id))
        .order("created_at", desc=True).limit(20).execute().data or []
    )
    reports = (
        admin.table("community_reports").select("*").eq("village_id", str(village_id))
        .order("submitted_at", desc=True).limit(report_limit).execute().data or []
    )

    village_public = {key: value for key, value in village.items() if key != "basin_id"}
    return {
        "mode": "demo",
        "demo_only": True,
        "village": village_public,
        "basin": basin,
        "station": station,
        "latest_reading": reading,
        "latest_evaluation": evaluation,
        "current_alert": alert,
        "alert_target": target,
        "impact": impact,
        "deliveries": deliveries,
        "reports": reports,
    }


@router.post("/demo/reports")
def create_demo_report(payload: CommunityReportCreate):
    """Demo-only write path: same community_reports shape and same rule-engine evaluation."""
    admin = get_admin_client()
    if not payload.village_id:
        raise HTTPException(400, "village_id is required for village-authority demo reports")
    village = _village(payload.village_id)
    station = _one("hydro_stations", {"id": payload.station_id}, "id,basin_id,station_name,river_name")
    if not station:
        raise HTTPException(404, "Selected station not found")
    if str(station["basin_id"]) != str(village["basin_id"]):
        raise HTTPException(400, "Station does not belong to the selected village's basin")

    now = datetime.now(timezone.utc).isoformat()
    report_code = f"CR-DEMO-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6].upper()}"
    metadata = dict(payload.metadata or {})
    metadata.update({"demo": True, "demo_context": "village_authority"})
    response = (
        admin.table("community_reports").insert({
            "report_code": report_code,
            "village_id": str(payload.village_id),
            "station_id": str(payload.station_id),
            "submitted_at": now,
            "latitude": payload.latitude if payload.latitude is not None else village.get("latitude"),
            "longitude": payload.longitude if payload.longitude is not None else village.get("longitude"),
            "report_type": payload.report_type,
            "description": payload.description,
            "severity": payload.severity,
            "multimedia_url": payload.multimedia_url,
            "reporter_user_id": None,
            "verification_status": "pending",
            "trust_score": None,
            "metadata": metadata,
        }).select("*").execute()
    )
    if not response.data:
        raise ValueError("Failed to create community report")
    report = response.data[0]
    evaluation = evaluate_community_report(report)
    return {"report": report, "evaluation": evaluation}

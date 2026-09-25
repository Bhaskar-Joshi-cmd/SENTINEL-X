from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query

from app.db.supabase import get_admin_client
from app.schemas import CommunityReportCreate
from app.services.rule_engine import evaluate_community_report

router = APIRouter(prefix="/community-member", tags=["Community Member"])
PUBLIC_ALERT_STATUSES = ["approved", "dispatching", "active"]


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
        get_admin_client()
        .table("hydro_stations")
        .select("id,station_code,station_name,river_name,district,state,latitude,longitude,warning_level_m,danger_level_m,highest_flood_level_m")
        .eq("basin_id", str(basin_id))
        .order("station_name")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _latest_reading(station_id: str | None) -> dict | None:
    if not station_id:
        return None
    rows = (
        get_admin_client()
        .table("hydro_readings")
        .select("id,station_id,observed_at,water_level_m,water_level_rate_m_hr,data_mode")
        .eq("station_id", station_id)
        .order("observed_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


@router.get("/summary")
def summary(village_id: UUID = Query(...)):
    """Demo village-scoped read model. Auth will later supply village_id from user_profiles."""
    admin = get_admin_client()
    village = _village(village_id)
    basin = _one("basins", {"id": village["basin_id"]}, "id,basin_code,basin_name,river_system")
    if not basin:
        raise HTTPException(404, "Village basin not found")

    station = _station(village["basin_id"])
    reading = _latest_reading(str(station["id"]) if station else None)

    public_alert = None
    impact = None
    latest_delivery = None

    targets = (
        admin.table("alert_targets")
        .select("alert_id,risk_score,time_to_impact_minutes,target_priority,target_status,created_at")
        .eq("village_id", str(village_id))
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )

    alert_ids = [row["alert_id"] for row in targets if row.get("alert_id")]
    if alert_ids:
        alerts = (
            admin.table("alerts")
            .select("*")
            .in_("id", alert_ids)
            .in_("status", PUBLIC_ALERT_STATUSES)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
            .data
            or []
        )
        if alerts:
            public_alert = alerts[0]
            target = next((row for row in targets if str(row.get("alert_id")) == str(public_alert["id"])), None)
            if public_alert.get("event_id"):
                impacts = (
                    admin.table("impact_assessments")
                    .select("event_id,village_id,risk_score,risk_level,time_to_impact_minutes,hazard_path_distance_km,downstream_order,population_at_risk")
                    .eq("event_id", str(public_alert["event_id"]))
                    .eq("village_id", str(village_id))
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                impact = impacts[0] if impacts else None
            if target and impact is None:
                impact = {
                    "village_id": str(village_id),
                    "risk_score": target.get("risk_score"),
                    "risk_level": None,
                    "time_to_impact_minutes": target.get("time_to_impact_minutes"),
                    "downstream_order": None,
                    "population_at_risk": village.get("population"),
                }

    deliveries = (
        admin.table("alert_deliveries")
        .select("id,alert_id,village_id,channel,delivery_status,sent_at,delivered_at,acknowledged_at,is_simulated,created_at")
        .eq("village_id", str(village_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    latest_delivery = deliveries[0] if deliveries else None

    village_public = {key: value for key, value in village.items() if key != "basin_id"}
    return {
        "mode": "demo",
        "demo_only": True,
        "village": village_public,
        "basin": basin,
        "station": station,
        "latest_reading": reading,
        "current_alert": public_alert,
        "impact": impact,
        "latest_delivery": latest_delivery,
    }


@router.post("/demo/reports")
def create_demo_report(payload: CommunityReportCreate):
    """Demo-only community write path using the canonical community_reports table and rule engine."""
    admin = get_admin_client()
    if not payload.village_id:
        raise HTTPException(400, "village_id is required for community member demo reports")

    village = _village(payload.village_id)
    station = _one("hydro_stations", {"id": payload.station_id}, "id,basin_id,station_name,river_name")
    if not station:
        raise HTTPException(404, "Selected station not found")
    if str(station["basin_id"]) != str(village["basin_id"]):
        raise HTTPException(400, "Station does not belong to the selected village's basin")

    now = datetime.now(timezone.utc)
    metadata = dict(payload.metadata or {})
    metadata.update({"demo": True, "demo_context": "community_member"})

    report_response = (
        admin.table("community_reports")
        .insert(
            {
                "report_code": f"CR-CM-{now.strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6].upper()}",
                "village_id": str(payload.village_id),
                "station_id": str(payload.station_id),
                "submitted_at": now.isoformat(),
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
            }
        )
        .select("*")
        .execute()
    )

    if not report_response.data:
        raise ValueError("Failed to create community report")

    report = report_response.data[0]
    evaluation = evaluate_community_report(report)
    return {"report": report, "evaluation": evaluation}


@router.post("/demo/acknowledge")
def acknowledge_demo_warning(payload: dict):
    """Demo-only persisted acknowledgement (replaces local-only UI state)."""
    admin = get_admin_client()
    village_id = payload.get("village_id") if isinstance(payload, dict) else None
    alert_id = payload.get("alert_id") if isinstance(payload, dict) else None
    if not village_id:
        raise HTTPException(400, "village_id is required to acknowledge a warning")
    now = datetime.now(timezone.utc).isoformat()
    target_rows = (
        admin.table("alert_targets")
        .select("alert_id")
        .eq("village_id", str(village_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    resolved_alert_id = alert_id or (target_rows[0].get("alert_id") if target_rows else None)
    if not resolved_alert_id:
        raise HTTPException(400, "No alert exists for this village yet; nothing to acknowledge")
    rows = (
        admin.table("alert_deliveries")
        .select("id")
        .eq("village_id", str(village_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        updated = (
            admin.table("alert_deliveries")
            .update({"acknowledged_at": now, "delivery_status": "acknowledged"})
            .eq("id", rows[0]["id"])
            .select("*")
            .execute()
            .data
            or []
        )
        return {"delivery": updated[0] if updated else None, "acknowledged_at": now}
    created = (
        admin.table("alert_deliveries")
        .insert(
            {
                "alert_id": resolved_alert_id,
                "village_id": str(village_id),
                "channel": "app_push",
                "delivery_status": "acknowledged",
                "attempt_number": 1,
                "sent_at": now,
                "delivered_at": now,
                "acknowledged_at": now,
                "is_simulated": True,
                "metadata": {"demo": True, "demo_context": "community_member_ack"},
            }
        )
        .select("*")
        .execute()
        .data
        or []
    )
    return {"delivery": created[0] if created else None, "acknowledged_at": now}

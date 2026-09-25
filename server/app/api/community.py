from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import require_roles
from app.db.supabase import get_admin_client
from app.schemas import (
    CommunityReportCorroborate,
    CommunityReportCreate,
    CommunityReportFieldVerify,
    CommunityReportReview,
    CommunityReportVerify,
)
from app.services.rule_engine import evaluate_community_report

router = APIRouter(prefix="/community", tags=["Community"])

VERIFY_ROLES = ("control_room", "disaster_authority", "admin")
FIELD_VERIFY_ROLES = ("community_manager", "admin")
CORROBORATE_ROLES = ("village_authority", "admin")
REVIEW_ROLES = ("control_room", "admin")

RIVER_REPORT_TYPES = {"flood", "water_rise"}


def _resolve_station_id(report_type: str, village: dict, station_id: UUID | str | None) -> str | None:
    """Resolve the relevant station for a report; station stays optional.

    River observations are linked to the nearest station in the village's
    basin when none is supplied. Non-river reports (landslide/road-block)
    intentionally carry no station instead of an artificial link.
    """
    if station_id:
        return str(station_id)
    if report_type not in RIVER_REPORT_TYPES:
        return None
    admin = get_admin_client()
    try:
        stations = (
            admin.table("hydro_stations")
            .select("id,latitude,longitude")
            .eq("basin_id", str(village.get("basin_id")))
            .execute()
            .data
            or []
        )
    except Exception:
        return None
    if not stations:
        return None
    lat = village.get("latitude")
    lon = village.get("longitude")
    if lat is None or lon is None:
        return str(stations[0]["id"])
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return str(stations[0]["id"])
    best = None
    best_dist = None
    for station in stations:
        try:
            dist = (float(station.get("latitude") or 0) - lat_f) ** 2 + (float(station.get("longitude") or 0) - lon_f) ** 2
        except (TypeError, ValueError):
            continue
        if best is None or dist < best_dist:
            best = station
            best_dist = dist
    return str(best["id"]) if best else str(stations[0]["id"])


def _get_report_or_404(report_id: UUID | str) -> dict:
    rows = (
        get_admin_client()
        .table("community_reports")
        .select("*")
        .eq("id", str(report_id))
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Community report not found")
    return rows[0]


def _update_report_status(report: dict, status: str, actor: str, comments: str | None, trust_score=None) -> dict:
    admin = get_admin_client()
    metadata = dict(report.get("metadata") or {})
    trail = list(metadata.get("verification_trail") or [])
    trail.append(
        {
            "from": report.get("verification_status"),
            "to": status,
            "actor": actor,
            "comments": comments,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    metadata.update(
        {
            "verified_by": actor,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "verify_comments": comments,
            "verify_action": status,
            "verification_trail": trail,
        }
    )
    payload: dict = {"verification_status": status, "metadata": metadata}
    if trust_score is not None:
        payload["trust_score"] = trust_score
    try:
        response = (
            admin.table("community_reports")
            .update(payload)
            .eq("id", str(report["id"]))
            .select("*")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "verification_status" in message and (
            "23514" in message or "check constraint" in message
        ):
            raise HTTPException(
                status_code=503,
                detail=(
                    f"The database rejects the lifecycle state '{status}'. Run "
                    "server/scripts/community_lifecycle_migration.sql in the Supabase SQL "
                    "Editor to allow the locked vocabulary (submitted, field_confirmed, "
                    "not_confirmed, corroborated, verified, rejected)."
                ),
            ) from exc
        raise
    updated = response.data or []
    if not updated:
        raise ValueError("Failed to update community report status")
    return updated[0]


def _field_verify(report_id: UUID | str, payload: CommunityReportFieldVerify, actor: str) -> dict:
    report = _get_report_or_404(report_id)
    status = "field_confirmed" if payload.decision == "confirmed" else "not_confirmed"
    updated = _update_report_status(report, status, actor, payload.comments)
    return {"report": updated, "evaluation": evaluate_community_report(updated)}


def _corroborate(report_id: UUID | str, payload: CommunityReportCorroborate, actor: str, actor_village_id: str | None) -> dict:
    report = _get_report_or_404(report_id)
    if actor_village_id and str(report.get("village_id")) != str(actor_village_id):
        raise HTTPException(status_code=403, detail="Village Authority may corroborate only its own village reports")
    updated = _update_report_status(report, "corroborated", actor, payload.comments)
    return {"report": updated, "evaluation": evaluate_community_report(updated)}


def _review(report_id: UUID | str, payload: CommunityReportReview, actor: str) -> dict:
    report = _get_report_or_404(report_id)
    if payload.action == "request_clarification":
        admin = get_admin_client()
        metadata = dict(report.get("metadata") or {})
        metadata["clarification_requested_by"] = actor
        metadata["clarification_requested_at"] = datetime.now(timezone.utc).isoformat()
        metadata["clarification_comments"] = payload.comments
        updated = (
            admin.table("community_reports")
            .update({"metadata": metadata})
            .eq("id", str(report["id"]))
            .select("*")
            .execute()
            .data
            or []
        )
        if not updated:
            raise ValueError("Failed to request clarification")
        return {"report": updated[0], "evaluation": evaluate_community_report(updated[0])}
    updated = _update_report_status(report, payload.action, actor, payload.comments, payload.trust_score)
    return {"report": updated, "evaluation": evaluate_community_report(updated)}


def _apply_verification(report_id: UUID | str, payload: CommunityReportVerify, actor: str) -> dict:
    admin = get_admin_client()
    rows = (
        admin.table("community_reports")
        .select("*")
        .eq("id", str(report_id))
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Community report not found")
    report = rows[0]
    now = datetime.now(timezone.utc).isoformat()
    metadata = dict(report.get("metadata") or {})
    metadata.update(
        {
            "verified_by": actor,
            "verified_at": now,
            "verify_comments": payload.comments,
            "verify_action": payload.action,
        }
    )
    updated = (
        admin.table("community_reports")
        .update(
            {
                "verification_status": payload.action,
                "trust_score": payload.trust_score,
                "metadata": metadata,
            }
        )
        .eq("id", str(report_id))
        .select("*")
        .execute()
        .data
        or []
    )
    if not updated:
        raise ValueError("Failed to update community report verification")
    # Re-run the report through the rule engine so the verification is
    # reflected in the next streamed evaluation snapshot.
    evaluation = evaluate_community_report(updated[0])
    return {"report": updated[0], "evaluation": evaluation}


_REPORT_OPTIONS_CACHE = {
    "rivers": [
        {"code": "TEESTA", "name": "Teesta"},
        {"code": "DESANG", "name": "Desang"},
    ],
    "report_types": [
        {"value": "flood", "label": "Flood / water entering area"},
        {"value": "water_rise", "label": "River water rising rapidly"},
        {"value": "landslide", "label": "Landslide"},
        {"value": "avalanche", "label": "Avalanche"},
        {
            "value": "damaged_infrastructure",
            "label": "Damaged road / bridge / infrastructure",
        },
        {"value": "blocked_route", "label": "Road / route blocked"},
        {"value": "unusual_sound", "label": "Unusual sound / vibration"},
        {"value": "other", "label": "Other observation"},
    ],
    "severity_levels": [
        {"value": "low", "label": "Low"},
        {"value": "moderate", "label": "Moderate"},
        {"value": "high", "label": "High"},
        {"value": "critical", "label": "Critical"},
    ],
}


@router.get("/options")
def report_options():
    return _REPORT_OPTIONS_CACHE


@router.post("/reports")
def create_report(
    payload: CommunityReportCreate,
    user: dict = Depends(
        require_roles(
            "community_member",
            "village_authority",
            "control_room",
            "admin",
        )
    ),
):
    admin = get_admin_client()

    station = (
        admin.table("hydro_stations")
        .select("id,basin_id,station_name,river_name")
        .eq("id", str(payload.station_id))
        .maybe_single()
        .execute()
        .data
    )

    if not station:
        raise HTTPException(
            status_code=404,
            detail="Selected station not found",
        )

    if user["role"] == "village_authority":
        if not user.get("village_id"):
            raise HTTPException(
                status_code=403,
                detail="Village Authority account is not assigned to a village",
            )
        if payload.village_id and str(payload.village_id) != str(user["village_id"]):
            raise HTTPException(
                status_code=403,
                detail="Village Authority may submit reports only for its assigned village",
            )
        village_id = str(user["village_id"])
    else:
        village_id = (
            str(payload.village_id)
            if payload.village_id
            else user.get("village_id")
        )

        if (
            user["role"] == "community_member"
            and user.get("village_id")
            and village_id != user["village_id"]
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Community members may submit reports only "
                    "for their registered village"
                ),
            )

    if not village_id:
        raise HTTPException(
            status_code=400,
            detail="village_id is required for this report",
        )

    now = datetime.now(timezone.utc).isoformat()

    report_code = (
        f"CR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-"
        f"{str(user['id'])[:8]}"
    )

    report_response = (
        admin.table("community_reports")
        .insert(
            {
                "report_code": report_code,
                "village_id": village_id,
                "station_id": str(payload.station_id),
                "submitted_at": now,
                "latitude": payload.latitude,
                "longitude": payload.longitude,
                "report_type": payload.report_type,
                "description": payload.description,
                "severity": payload.severity,
                "multimedia_url": payload.multimedia_url,
                "reporter_user_id": user["id"],
                "verification_status": "pending",
                "trust_score": None,
                "metadata": payload.metadata,
            }
        )
        .select("*")
        .execute()
    )

    if not report_response.data:
        raise ValueError("Failed to create community report")

    row = report_response.data[0]

    evaluation = evaluate_community_report(row)

    return {
        "report": row,
        "evaluation": evaluation,
    }


@router.get("/reports/recent")
def recent_reports(
    limit: int = 20,
    user: dict = Depends(
        require_roles(
            "control_room",
            "disaster_authority",
            "admin",
        )
    ),
):
    del user

    rows = (
        get_admin_client()
        .table("community_reports")
        .select(
            "id,report_code,village_id,station_id,submitted_at,"
            "latitude,longitude,report_type,description,severity,"
            "multimedia_url,verification_status,trust_score,metadata"
        )
        .order("submitted_at", desc=True)
        .limit(min(limit, 100))
        .execute()
        .data
        or []
    )

    return {"items": rows}


@router.post("/reports/{report_id}/field-verify")
def field_verify_report(
    report_id: UUID,
    payload: CommunityReportFieldVerify,
    user: dict = Depends(require_roles(*FIELD_VERIFY_ROLES)),
):
    """Community Manager field confirmation: confirmed -> field_confirmed, disputed -> not_confirmed."""
    return _field_verify(report_id, payload, actor=str(user.get("id")))


@router.post("/reports/{report_id}/corroborate")
def corroborate_report(
    report_id: UUID,
    payload: CommunityReportCorroborate,
    user: dict = Depends(require_roles(*CORROBORATE_ROLES)),
):
    """Village Authority corroboration (own village only)."""
    return _corroborate(report_id, payload, actor=str(user.get("id")), actor_village_id=user.get("village_id"))


@router.post("/reports/{report_id}/review")
def review_report(
    report_id: UUID,
    payload: CommunityReportReview,
    user: dict = Depends(require_roles(*REVIEW_ROLES)),
):
    """Control Room review: verified / rejected / request_clarification. Never called 'approval'."""
    return _review(report_id, payload, actor=str(user.get("id")))


@router.post("/demo/reports/{report_id}/field-verify")
def field_verify_demo_report(report_id: UUID, payload: CommunityReportFieldVerify):
    """Demo-only field verification path (no auth)."""
    return _field_verify(report_id, payload, actor="demo-community-manager")


@router.post("/demo/reports/{report_id}/corroborate")
def corroborate_demo_report(report_id: UUID, payload: CommunityReportCorroborate):
    """Demo-only corroboration path (no auth)."""
    return _corroborate(report_id, payload, actor="demo-village-authority", actor_village_id=None)


@router.post("/demo/reports/{report_id}/review")
def review_demo_report(report_id: UUID, payload: CommunityReportReview):
    """Demo-only Control Room review path (no auth)."""
    return _review(report_id, payload, actor="demo-control-room")


@router.post("/reports/{report_id}/verify")
def verify_report(
    report_id: UUID,
    payload: CommunityReportVerify,
    user: dict = Depends(require_roles(*VERIFY_ROLES)),
):
    """Backward-compatible alias of the Control Room review action (verified/rejected)."""
    return _review(
        report_id,
        CommunityReportReview(action=payload.action, trust_score=payload.trust_score, comments=payload.comments),
        actor=str(user.get("id")),
    )


@router.post("/demo/reports/{report_id}/verify")
def verify_demo_report(report_id: UUID, payload: CommunityReportVerify):
    """Demo-only alias of the Control Room review path (no auth)."""
    return _review(
        report_id,
        CommunityReportReview(action=payload.action, trust_score=payload.trust_score, comments=payload.comments),
        actor="demo-control-room",
    )
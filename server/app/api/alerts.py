from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user, require_roles
from app.db.supabase import get_admin_client
from app.schemas import ApprovalCreate
from app.services.alert_service import approve_alert
from app.services.impact_engine import build_impact_assessment

router = APIRouter(prefix="/alerts", tags=["Alerts"])

# The alerts table's own check constraint has no 'rejected' state; the
# schema-native terminal refusal state is 'cancelled'. The approval trail
# still records the semantic action 'rejected' for audit purposes.
ALERT_REJECTED_STATUS = "cancelled"


@router.get("/active")
def active_alerts():
    rows = (
        get_admin_client()
        .table("alerts")
        .select("*")
        .in_("status", ["pending_approval", "approved", "dispatching", "active"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
        or []
    )
    return {"items": rows}


@router.get("/{alert_id}")
def get_alert(alert_id: UUID):
    admin = get_admin_client()
    alert = admin.table("alerts").select("*").eq("id", str(alert_id)).maybe_single().execute().data
    if not alert:
        raise HTTPException(404, "Alert not found")
    targets = admin.table("alert_targets").select("*").eq("alert_id", str(alert_id)).execute().data or []
    deliveries = admin.table("alert_deliveries").select("*").eq("alert_id", str(alert_id)).order("created_at", desc=True).execute().data or []
    return {"alert": alert, "targets": targets, "deliveries": deliveries}


@router.get("/{alert_id}/impact")
def get_impact(alert_id: UUID):
    admin = get_admin_client()
    alert = admin.table("alerts").select("event_id").eq("id", str(alert_id)).maybe_single().execute().data
    if not alert or not alert.get("event_id"):
        raise HTTPException(404, "Alert or event not found")
    items = (
        admin.table("impact_assessments")
        .select("event_id,village_id,risk_score,risk_level,time_to_impact_minutes,hazard_path_distance_km,downstream_order,population_at_risk,calculation_method,model_version")
        .eq("event_id", str(alert["event_id"]))
        .order("downstream_order")
        .execute()
        .data
        or []
    )
    return {"event_id": alert["event_id"], "items": items}


@router.post("/{alert_id}/impact")
async def build_impact(alert_id: UUID, user: dict = Depends(require_roles("control_room", "disaster_authority", "admin"))):
    del user
    alert = get_admin_client().table("alerts").select("event_id").eq("id", str(alert_id)).maybe_single().execute().data
    if not alert:
        raise HTTPException(404, "Alert not found")
    items = await build_impact_assessment(UUID(alert["event_id"]))
    return {"items": items}


@router.post("/{alert_id}/approve")
async def approve(alert_id: UUID, payload: ApprovalCreate, user: dict = Depends(get_current_user)):
    if user.get("role") not in {"disaster_authority", "admin"}:
        raise HTTPException(403, "Only the authorized Disaster Authority can approve official alert dispatch")
    try:
        return await approve_alert(alert_id, user, payload.comments)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/{alert_id}/reject")
def reject(alert_id: UUID, payload: ApprovalCreate, user: dict = Depends(get_current_user)):
    """Disaster Authority rejects an official alert (terminal for this alert)."""
    if user.get("role") not in {"disaster_authority", "admin"}:
        raise HTTPException(403, "Only the authorized Disaster Authority can reject official alerts")
    admin = get_admin_client()
    alert = admin.table("alerts").select("id,status").eq("id", str(alert_id)).maybe_single().execute().data
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.get("status") not in {"draft", "pending_approval"}:
        raise HTTPException(400, f"Alert cannot be rejected from status '{alert.get('status')}'")
    rows = (
        admin.table("alerts")
        .update({"status": ALERT_REJECTED_STATUS})
        .eq("id", str(alert_id))
        .select("*")
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(400, "Failed to reject alert")
    admin.table("alert_approvals").insert(
        {
            "alert_id": str(alert_id),
            "user_id": user["id"],
            "action": "rejected",
            "comments": payload.comments,
        }
    ).execute()
    return rows[0]


def _demo_authority_user() -> dict:
    """Resolve a usable actor for demo-mode authorization.

    The demo dashboard has no bearer token, so the actor is taken from the
    seeded ``user_profiles`` instead. ``approve_alert`` treats the id as
    optional, so the demo flow still records the alert state change when no
    Disaster Authority profile has been seeded yet.
    """
    actor_id: str | None = None
    try:
        rows = (
            get_admin_client()
            .table("user_profiles")
            .select("id,role")
            .in_("role", ["disaster_authority", "admin"])
            .limit(1)
            .execute()
            .data
            or []
        )
        if rows:
            actor_id = str(rows[0]["id"])
    except Exception:
        actor_id = None
    return {
        "id": actor_id,
        "role": "disaster_authority",
        "full_name": "Demo Disaster Authority",
    }


@router.post("/demo/{alert_id}/approve")
async def approve_demo(alert_id: UUID, payload: ApprovalCreate | None = None):
    """Demo authorization driving the Disaster Authority dashboard.

    Mirrors the authenticated approval flow (impact assessment + simulated
    last-mile dispatch) while resolving the actor from demo profiles.
    """
    user = _demo_authority_user()
    comments = payload.comments if payload else None
    try:
        alert = await approve_alert(alert_id, user, comments)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"alert": alert}


@router.post("/demo/{alert_id}/reject")
def reject_demo(alert_id: UUID, payload: ApprovalCreate | None = None):
    """Demo rejection driving the Disaster Authority dashboard."""
    admin = get_admin_client()
    alert = admin.table("alerts").select("id,status").eq("id", str(alert_id)).maybe_single().execute().data
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.get("status") not in {"draft", "pending_approval"}:
        raise HTTPException(400, f"Alert cannot be rejected from status '{alert.get('status')}'")
    rows = (
        admin.table("alerts")
        .update({"status": ALERT_REJECTED_STATUS})
        .eq("id", str(alert_id))
        .select("*")
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(400, "Failed to reject alert")
    actor_id = _demo_authority_user().get("id")
    if actor_id:
        try:
            admin.table("alert_approvals").insert(
                {
                    "alert_id": str(alert_id),
                    "user_id": actor_id,
                    "action": "rejected",
                    "comments": payload.comments if payload else None,
                }
            ).execute()
        except Exception:
            # Demo seeds may not include a matching profile row.
            pass
    return {"alert": rows[0]}


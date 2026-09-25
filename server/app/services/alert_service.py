from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.db.supabase import get_admin_client
from app.services.impact_engine import build_impact_assessment


async def approve_alert(
    alert_id: UUID,
    user: dict,
    comments: str | None = None,
) -> dict:
    admin = get_admin_client()

    # Find the alert.
    alert_rows = (
        admin.table("alerts")
        .select("*")
        .eq("id", str(alert_id))
        .limit(1)
        .execute()
        .data
        or []
    )

    if not alert_rows:
        raise ValueError("Alert not found")

    alert = alert_rows[0]

    # Only draft/pending alerts may be approved.
    if alert["status"] not in {
        "draft",
        "pending_approval",
    }:
        raise ValueError(
            f"Alert cannot be approved from status "
            f"'{alert['status']}'"
        )

    # The API already restricts approval to the authorized
    # Disaster Authority (DDMA-side) / admin. The Control Room
    # verifies and recommends but never approves official alerts.
    if user.get("role") not in {
        "disaster_authority",
        "admin",
    }:
        raise PermissionError(
            "Only the authorized Disaster Authority "
            "can approve official alert dispatch"
        )

    now = datetime.now(timezone.utc).isoformat()

    # Demo mode may run without a seeded profile row, so the actor id is
    # optional; the authenticated path always supplies one.
    actor_id = (user or {}).get("id")

    approve_payload: dict = {
        "status": "approved",
        "approved_at": now,
    }
    if actor_id:
        approve_payload["approved_by"] = actor_id

    # Mark the alert as approved.
    updated_response = (
        admin.table("alerts")
        .update(approve_payload)
        .eq("id", str(alert_id))
        .select("*")
        .execute()
    )

    if not updated_response.data:
        raise ValueError(
            "Failed to update alert approval status"
        )

    updated_alert = updated_response.data[0]

    # Record the approval action.
    if actor_id:
        try:
            admin.table("alert_approvals").insert(
                {
                    "alert_id": str(alert_id),
                    "user_id": actor_id,
                    "action": "approved",
                    "comments": comments,
                }
            ).execute()
        except Exception:
            # Demo seeds may not include a matching profile row.
            pass

    # Make sure impact assessments exist.
    await ensure_impact_assessment(
        alert["event_id"]
    )

    # Create targets and perform simulated dispatch.
    await create_targets_and_dispatch(
        str(alert_id)
    )

    # Return the latest alert state from the database.
    refreshed_rows = (
        admin.table("alerts")
        .select("*")
        .eq("id", str(alert_id))
        .limit(1)
        .execute()
        .data
        or []
    )

    if refreshed_rows:
        return refreshed_rows[0]

    return updated_alert


async def ensure_impact_assessment(
    event_id: str,
) -> list[dict]:
    admin = get_admin_client()

    existing = (
        admin.table("impact_assessments")
        .select("*")
        .eq("event_id", event_id)
        .execute()
        .data
        or []
    )

    if existing:
        return existing

    # Use the same impact engine used by the rest
    # of the prototype.
    return await build_impact_assessment(
        UUID(event_id)
    )


async def create_targets_and_dispatch(
    alert_id: str,
) -> dict:
    admin = get_admin_client()

    alert_rows = (
        admin.table("alerts")
        .select("*")
        .eq("id", alert_id)
        .limit(1)
        .execute()
        .data
        or []
    )

    if not alert_rows:
        raise ValueError("Alert not found")

    alert = alert_rows[0]
    event_id = alert["event_id"]

    # Get existing impact assessments.
    impacts = (
        admin.table("impact_assessments")
        .select("*")
        .eq("event_id", event_id)
        .order(
            "time_to_impact_minutes",
            desc=False,
        )
        .execute()
        .data
        or []
    )

    # If none exist, build them now.
    if not impacts:
        impacts = await ensure_impact_assessment(
            event_id
        )

    target_rows = []

    for impact in impacts:
        target_rows.append(
            {
                "alert_id": alert_id,
                "village_id": impact["village_id"],
                "risk_score": impact.get("risk_score"),
                "time_to_impact_minutes": impact.get(
                    "time_to_impact_minutes"
                ),
                "target_priority": alert.get(
                    "priority",
                    "P2",
                ),
                "target_status": "pending",
            }
        )

    # Avoid creating duplicate targets.
    if target_rows:
        admin.table("alert_targets").upsert(
            target_rows,
            on_conflict="alert_id,village_id",
        ).execute()

    await dispatch_to_targets(alert_id)

    return {
        "targets_created": len(target_rows),
    }


async def dispatch_to_targets(
    alert_id: str,
) -> None:
    admin = get_admin_client()

    alert_rows = (
        admin.table("alerts")
        .select("*")
        .eq("id", alert_id)
        .limit(1)
        .execute()
        .data
        or []
    )

    if not alert_rows:
        raise ValueError("Alert not found")

    targets = (
        admin.table("alert_targets")
        .select("*")
        .eq("alert_id", alert_id)
        .execute()
        .data
        or []
    )

    # Communication remains simulated in the current prototype.
    for target in targets:
        village_rows = (
            admin.table("villages")
            .select(
                "id,village_name,"
                "internet_available,"
                "cellular_available"
            )
            .eq(
                "id",
                target["village_id"],
            )
            .limit(1)
            .execute()
            .data
            or []
        )

        village = (
            village_rows[0]
            if village_rows
            else {}
        )

        internet_available = (
            village.get("internet_available")
            is True
        )

        cellular_available = (
            village.get("cellular_available")
            is True
        )

        if internet_available:
            channels = ["app_push"]

        elif cellular_available:
            channels = ["sms", "call"]

        else:
            channels = [
                "lora",
                "siren",
                "strobe",
                "voice_pa",
            ]

        delivery_rows = []

        now = datetime.now(
            timezone.utc
        ).isoformat()

        for channel in channels:
            delivery_rows.append(
                {
                    "alert_id": alert_id,
                    "village_id": target[
                        "village_id"
                    ],
                    "node_id": None,
                    "channel": channel,
                    "delivery_status": "delivered",
                    "attempt_number": 1,
                    "sent_at": now,
                    "delivered_at": now,
                    "acknowledged_at": (
                        now
                        if channel
                        in {
                            "app_push",
                            "sms",
                            "lora",
                        }
                        else None
                    ),
                    "failure_reason": None,
                    "is_simulated": True,
                    "metadata": {
                        "demo": True,
                        "note": (
                            "Simulated dispatch; "
                            "replace with real channel "
                            "provider later"
                        ),
                    },
                }
            )

        if delivery_rows:
            admin.table(
                "alert_deliveries"
            ).insert(
                delivery_rows
            ).execute()

        admin.table(
            "alert_targets"
        ).update(
            {
                "target_status": "reached"
            }
        ).eq(
            "id",
            target["id"],
        ).execute()

    # Once simulated dispatch has completed,
    # move the alert to active.
    admin.table("alerts").update(
        {
            "status": "active"
        }
    ).eq(
        "id",
        alert_id,
    ).execute()
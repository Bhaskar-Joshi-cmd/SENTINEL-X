from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, HTTPException

from app.db.supabase import get_admin_client

router = APIRouter(prefix="/connectivity", tags=["Connectivity"])


CHANNEL_GROUPS = {
    "app_push": "internet_app",
    "web": "internet_app",
    "sms": "cellular",
    "call": "cellular",
    "lora": "offline_local",
    "siren": "offline_local",
    "strobe": "offline_local",
    "voice_pa": "offline_local",
}


def _availability(value: Any) -> bool | None:
    if value is True:
        return True
    if value is False:
        return False
    return None


def _delivery_state(rows: list[dict]) -> str:
    if not rows:
        return "not_dispatched"
    statuses = {str(row.get("delivery_status") or "pending").lower() for row in rows}
    if "delivered" in statuses or "reached" in statuses:
        return "delivered"
    if "failed" in statuses and statuses.issubset({"failed"}):
        return "failed"
    return "pending"


def _route_from_rows(rows: list[dict]) -> str | None:
    if not rows:
        return None
    delivered = [row for row in rows if str(row.get("delivery_status") or "").lower() in {"delivered", "reached"}]
    candidates = delivered or rows
    priority = {"internet_app": 0, "cellular": 1, "offline_local": 2}
    candidates = sorted(candidates, key=lambda row: priority.get(CHANNEL_GROUPS.get(str(row.get("channel") or ""), "offline_local"), 9))
    channel = str(candidates[0].get("channel") or "").lower()
    return CHANNEL_GROUPS.get(channel)


@router.get("/summary")
def summary(river_code: str):
    admin = get_admin_client()
    code = river_code.upper()

    basin_rows = (
        admin.table("basins")
        .select("id,basin_code,basin_name")
        .eq("basin_code", code)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not basin_rows:
        raise HTTPException(404, "River not found")
    basin = basin_rows[0]

    villages = (
        admin.table("villages")
        .select("id,village_name,village_code,population,internet_available,cellular_available")
        .eq("basin_id", basin["id"])
        .order("village_name")
        .execute()
        .data
        or []
    )
    village_by_id = {row["id"]: row for row in villages}
    village_ids = list(village_by_id)

    active_alerts = (
        admin.table("alerts")
        .select("id,alert_code,title,status,priority,created_at,event_id")
        .in_("status", ["pending_approval", "approved", "dispatching", "active"])
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )

    event_ids = [row.get("event_id") for row in active_alerts if row.get("event_id")]
    event_rows = []
    if event_ids:
        event_rows = (
            admin.table("events")
            .select("id,basin_id")
            .in_("id", event_ids)
            .execute()
            .data
            or []
        )
    basin_event_ids = {row["id"] for row in event_rows if row.get("basin_id") == basin["id"]}
    basin_alerts = [row for row in active_alerts if row.get("event_id") in basin_event_ids]
    basin_alert_ids = [row["id"] for row in basin_alerts]

    targets: list[dict] = []
    deliveries: list[dict] = []
    if basin_alert_ids and village_ids:
        targets = (
            admin.table("alert_targets")
            .select("id,alert_id,village_id,target_status,risk_score,time_to_impact_minutes,target_priority")
            .in_("alert_id", basin_alert_ids)
            .in_("village_id", village_ids)
            .execute()
            .data
            or []
        )
        deliveries = (
            admin.table("alert_deliveries")
            .select("id,alert_id,village_id,channel,delivery_status,sent_at,delivered_at,acknowledged_at,is_simulated,created_at")
            .in_("alert_id", basin_alert_ids)
            .in_("village_id", village_ids)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
            .data
            or []
        )

    target_by_village: dict[str, list[dict]] = defaultdict(list)
    delivery_by_village: dict[str, list[dict]] = defaultdict(list)
    for row in targets:
        target_by_village[row["village_id"]].append(row)
    for row in deliveries:
        delivery_by_village[row["village_id"]].append(row)

    village_payload = []
    for village in villages:
        rows = delivery_by_village.get(village["id"], [])
        latest = rows[0] if rows else None
        target_rows = target_by_village.get(village["id"], [])
        route = _route_from_rows(rows)
        if route is None and target_rows:
            if village.get("internet_available") is True:
                route = "internet_app"
            elif village.get("cellular_available") is True:
                route = "cellular"
            else:
                route = "offline_local"

        village_payload.append(
            {
                "village_id": village["id"],
                "village_name": village.get("village_name"),
                "village_code": village.get("village_code"),
                "population": village.get("population"),
                "internet_available": _availability(village.get("internet_available")),
                "cellular_available": _availability(village.get("cellular_available")),
                "target_status": target_rows[0].get("target_status") if target_rows else "not_targeted",
                "selected_route": route,
                "delivery_status": _delivery_state(rows),
                "delivery_count": len(rows),
                "last_delivery_at": (latest.get("delivered_at") or latest.get("sent_at") or latest.get("created_at")) if latest else None,
                "simulated": any(row.get("is_simulated") is True for row in rows),
            }
        )

    delivered_villages = sum(1 for village in village_payload if village["delivery_status"] == "delivered")
    targeted_villages = sum(1 for village in village_payload if village["target_status"] != "not_targeted")
    delivered_records = sum(1 for row in deliveries if str(row.get("delivery_status") or "").lower() in {"delivered", "reached"})
    pending_records = sum(1 for row in deliveries if str(row.get("delivery_status") or "").lower() in {"pending", "queued", "dispatching"})
    failed_records = sum(1 for row in deliveries if str(row.get("delivery_status") or "").lower() == "failed")
    internet_configured = sum(1 for village in villages if village.get("internet_available") is True)
    cellular_configured = sum(1 for village in villages if village.get("cellular_available") is True)

    last_delivery = max(
        (row.get("delivered_at") or row.get("sent_at") or row.get("created_at") for row in deliveries),
        default=None,
    )

    channel_counts: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "records": 0,
        "delivered": 0,
        "pending": 0,
        "failed": 0,
        "simulated": 0,
        "last_activity_at": None,
    })
    for row in deliveries:
        channel = str(row.get("channel") or "unknown")
        bucket = channel_counts[channel]
        bucket["records"] += 1
        status = str(row.get("delivery_status") or "pending").lower()
        if status in {"delivered", "reached"}:
            bucket["delivered"] += 1
        elif status == "failed":
            bucket["failed"] += 1
        else:
            bucket["pending"] += 1
        if row.get("is_simulated") is True:
            bucket["simulated"] += 1
        bucket["last_activity_at"] = bucket["last_activity_at"] or row.get("delivered_at") or row.get("sent_at") or row.get("created_at")

    return {
        "river": basin,
        "active_alert": basin_alerts[0] if basin_alerts else None,
        "summary": {
            "villages": len(villages),
            "active_alerts": len(basin_alerts),
            "targeted_villages": targeted_villages,
            "delivered_villages": delivered_villages,
            "delivery_records": len(deliveries),
            "delivered_records": delivered_records,
            "pending_records": pending_records,
            "failed_records": failed_records,
            "internet_configured_villages": internet_configured,
            "cellular_configured_villages": cellular_configured,
            "last_delivery_at": last_delivery,
        },
        "channels": [
            {
                "channel": channel,
                **values,
            }
            for channel, values in sorted(channel_counts.items())
        ],
        "villages": village_payload,
        "offline_relay": {
            "status": "integration_pending",
            "label": "Android Nearby Connections",
            "telemetry_connected": False,
        },
        "source_errors": [],
    }

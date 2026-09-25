# API Reference

Base URL: `/api` (all routers are mounted with that prefix in `server/app/main.py`).
Interactive docs: `http://127.0.0.1:8000/docs` (FastAPI/OpenAPI generated from the code).

## Authentication model

Two tiers exist side by side:

- **Authenticated routes** require `Authorization: Bearer <supabase access token>` and a role check via `server/app/auth/dependencies.py`. Roles are `admin`, `control_room`, `disaster_authority`, `village_authority`, `community_manager`, `community_member`, `observer`.
- **Demo routes** (paths containing `/demo`) intentionally skip the token check so the prototype can be explored without Supabase login. They are for demonstration only.

Error behaviour: `400` validation/`ValueError`, `401` missing/invalid token or bad sensor key, `403` role not permitted or inactive profile, `404` missing resource, `503` when a lifecycle database constraint rejects a state (message names the required migration).

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | `{service, status, checks}`. |

## Reference data

| Method | Path | Auth | Query | Returns |
|---|---|---|---|---|
| GET | `/rivers` | public | — | `{items: Basin[]}` for `TEESTA` and `DESANG` |
| GET | `/rivers/{river_code}/stations` | public | — | `{river, items: Station[]}`; `404` if river unknown |
| GET | `/rivers/{river_code}/villages` | public | — | `{river, items: Village[]}` |
| GET | `/hydro/readings` | public | `station_code` (required), `limit` 1–500 (default 50) | `{station, items: HydroReading[]}` newest first |

## Dashboard / aggregations

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/dashboard/summary` | public | — | Stations + latest reading each, last 20 evaluations, active alerts. Independent Supabase queries run concurrently in a thread executor. |
| GET | `/inbound/summary` | public | `river_code` (required), `limit` 1–100 (default 50) | Normalized hydro/sensor/community/evaluation evidence for one basin, with `source_errors`. |
| GET | `/connectivity/summary` | public | `river_code` (required) | Reachability, per-channel delivery counts, offline relay state. |
| GET | `/village-delivery/summary` | public | `river_code` (required) | Per-village matrix of impact, target, and delivery rows. Read-only; creates nothing. |
| GET | `/community-member/summary` | public | `village_id` (required) | Demo village-scoped read model (warning, impact, latest delivery). |
| GET | `/village-authority/summary` | public | `village_id` (required), `report_limit` 1–50 (default 12) | Village warning, station context, impact, deliveries, recent reports. |
| GET | `/admin/summary` | public | — | Read-only metrics, service checks, basin list, role counts, freshness. |
| GET | `/android/overview` | public | `river_code` (optional) | Compact payload for the Android relay client. |

## Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/auth/me` | bearer | Returns the caller's `id`, `email`, `full_name`, `role`, `village_id` from `user_profiles`. |

## Alerts

| Method | Path | Auth | Notes |
|---|---|---|---|

## Community reports

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| GET | `/community/options` | public | Cached list of rivers, report types, severity levels. |
| POST | `/community/reports` | bearer | `CommunityReportCreate`. Inserts and evaluates the report. |
| GET | `/community/reports/recent` | public | `limit` (capped 100) recent reports. |
| POST | `/community/reports/{id}/field-verify` | community_manager, admin | `field_confirmed` or `not_confirmed`. |
| POST | `/community/reports/{id}/corroborate` | village_authority, admin | Requires caller's `village_id` to match the report. |
| POST | `/community/reports/{id}/review` | control_room, admin | Control Room review: verify / reject / request clarification. |
| POST | `/community/reports/{id}/verify` | control_room, disaster_authority, admin | Legacy alias of `review`. |
| POST | `/community/demo/reports/{id}/field-verify` | none (demo) | Demo equivalent. |
| POST | `/community/demo/reports/{id}/corroborate` | none (demo) | Demo equivalent. |
| POST | `/community/demo/reports/{id}/review` | none (demo) | Demo equivalent. |
| POST | `/community/demo/reports/{id}/verify` | none (demo) | Demo equivalent. |
| POST | `/community-member/demo/reports` | none (demo) | Community Member report submission. |
| POST | `/village-authority/demo/reports` | none (demo) | Village Authority report submission. |
| POST | `/community-member/demo/acknowledge` | none (demo) | Stamps `alert_deliveries.acknowledged_at` for the village's latest target. `400` if there is no alert to acknowledge. |

## Sensors

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/sensors/readings` | `x-sensor-key` header must equal `SENSOR_INGEST_KEY` (when configured) | Body `SensorReadingCreate` (`sensor_code`, `sensor_type`, `numeric_value`, `unit`, `observed_at`, …). Stores the reading and re-evaluates the station. Missing/incorrect key → `401`. |

## Demo replay / stream

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/demo/replay/tick` | none | One automatic tick: advances **every station in both basins** by one historical reading, scores it, rebuilds village impact. Guarded by an `asyncio.Lock`; a concurrent call returns `{tick_at: null, stations: [], coalesced: true}`. The blocking evaluation runs in a worker thread. |
| POST | `/demo/replay/{river_code}` | none | `ReplayRequest` (`station_code?`, `limit` 1–500, `delay_seconds` 0–10). Replays up to `limit` readings for one station. |
| POST | `/demo/replay/{river_code}/step` | none | `ReplayStepRequest` (`station_code`, `reading_id`). Scores a single reading and returns its impact. |

## Conventions

- JSON in / JSON out; errors use FastAPI's `{detail}` shape.
- UUIDs are used for all entity identifiers.
- Timestamps are ISO-8601 and stored as `timestamptz`.
- `river_code` is upper-cased by the backend; accepted values are `TEESTA` and `DESANG`.

| GET | `/alerts/active` | public | Alerts in `pending_approval`/`approved`/`dispatching`/`active`. |
| GET | `/alerts/{alert_id}` | public | Alert + targets + deliveries. |
| GET | `/alerts/{alert_id}/impact` | public | Persisted `impact_assessments` for the alert's event. |
| POST | `/alerts/{alert_id}/impact` | control_room, disaster_authority, admin | Rebuilds impact for the event. |
| POST | `/alerts/{alert_id}/approve` | bearer; role must be disaster_authority/admin | Body `{comments?}`. Writes `alert_approvals` audit row. |
| POST | `/alerts/{alert_id}/reject` | bearer; role must be disaster_authority/admin | Cancels the alert, recording the rejection. |
| POST | `/alerts/demo/{alert_id}/approve` | none (demo) | Same transition without a token. |
| POST | `/alerts/demo/{alert_id}/reject` | none (demo) | Same cancellation without a token. |

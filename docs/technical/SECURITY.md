# Security

Describes the security model **as currently implemented**, including its gaps. Nothing here was changed as part of the documentation pass.

## Authentication

`server/app/auth/dependencies.py` provides the only authentication path:

- `get_current_user` requires an `Authorization: Bearer <token>` header. The token is verified with the Supabase **public** client (`get_public_client()` → `auth.get_user(token)`). An absent, malformed, or invalid token yields `401`.
- After token verification the user's `user_profiles` row is loaded. A missing profile or `is_active = false` yields `403`.
- The resolved identity is a dict: `id`, `email`, `full_name`, `role`, `village_id`.

## Authorization

`require_roles(*roles)` is a FastAPI dependency factory. It depends on `get_current_user` and returns `403` when `user.get("role")` is not in the allowed set.

Roles: `admin`, `control_room`, `disaster_authority`, `village_authority`, `community_manager`, `community_member`, `observer`.

Separation of duties is enforced in the routes, not just the UI:

| Action | Allowed roles |
|---|---|
| Report submission | community_member, village_authority, community_manager, control_room, admin |
| Field confirm / dispute | community_manager, admin |
| Corroborate (own village only) | village_authority, admin — the route compares the caller's `village_id` with the report's |
| Evidence review | control_room, admin |
| **Official alert approve / reject** | disaster_authority, admin (control_room is deliberately excluded) |
| Rebuild impact | control_room, disaster_authority, admin |
| Sensor ingestion | possession of the `SENSOR_INGEST_KEY` value in the `x-sensor-key` header |

## Demo routes are unauthenticated — this is intentional but important

Every path containing `/demo` (for example `POST /api/demo/replay/tick`, `POST /api/alerts/demo/{id}/approve`, `POST /api/community-member/demo/reports`) **bypasses the token check**. They exist so the prototype can be demonstrated without Supabase login.

This means a deployed demo instance would let anyone approve a demo alert. Before any real deployment, demo routes must be removed or gated.

## Secrets and environment variables

Defined in `server/app/core/config.py` (`Settings`, reading `server/.env`):

| Variable | Required | Purpose | Exposure risk |
|---|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL | low |
| `SUPABASE_ANON_KEY` | yes | public/anon key, used for Auth verification | low (designed to be public) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **bypasses RLS**; full read/write | **critical** |
| `SENSOR_INGEST_KEY` | no (default empty) | shared secret for sensor ingestion | high |
| `REPLAY_STEP_DELAY_SECONDS` | no (default `2.0`) | replay pacing | none |
| `CORS_ORIGINS` | no (default `http://localhost:5173,http://localhost:3000`) | comma-separated allowed origins | medium |
| `VITE_API_BASE_URL` | no | frontend API base; defaults to `http://127.0.0.1:8000/api` on localhost, `/api` elsewhere | low |

`.gitignore` ignores `**/.env` and `**/.env.*` while keeping `.env.example` tracked. `.env.example` contains only placeholders — no real credentials.

The service-role key lives only in the backend. It is never referenced by frontend code; the SPA only uses `VITE_API_BASE_URL`.

## CORS

Configured in `server/app/main.py`:

- `allow_origins` from `CORS_ORIGINS`
- `allow_origin_regex` additionally permits any `localhost`/`127.0.0.1`/`[::1]` origin on any port
- `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`

The regex is convenient for local development but is broader than a production policy should be.

## Input validation

Pydantic models in `server/app/schemas/common.py` validate request bodies before handlers run:

- `ReplayRequest.limit` is bounded 1–500, `delay_seconds` 0–10.
- `ReplayStepRequest.reading_id` is a UUID.
- `CommunityReportCreate` restricts `report_type` and `severity` to literal sets and trims `description`.
- `SensorReadingCreate` bounds `battery_percentage` to 0–100.
- `ApprovalCreate.comments` is capped at 1000 characters.

Query parameters are bounded in the route signatures (`limit` ge/le, `village_id` as `UUID`).

IDs interpolated into Supabase filters come from validated UUID path/query parameters, which limits injection surface; the service-role key nevertheless means a bug here has full-database consequence.

## Sensitive data handling

- No PII fields beyond user profile name/email and report descriptions/locations.
- Report `metadata` may carry verification audit data (who verified, when, comments).
- `alert_deliveries.is_simulated` defaults to `TRUE`; nothing is actually sent to a carrier in this prototype, so no message content leaves the system.


## Known security concerns (documented, not fixed)

1. **Demo routes are unauthenticated.** Highest practical risk if deployed as-is.
2. **No Row Level Security.** The service-role key bypasses RLS entirely; all authorization is application code. A single missed `require_roles` exposes an admin action.
3. **Frontend role switcher is cosmetic.** The SPA role selector does not confer authority, but it does mean the UI can display any role's screens; only backend checks are meaningful.
4. **Village scoping is not enforced in the demo pages.** Demo village selectors let a user view any village's data.
5. **CORS allows any localhost port** and, via `CORS_ORIGINS`, whatever is configured — acceptable locally, should be pinned in production.
6. **`SENSOR_INGEST_KEY` is a single shared secret** with no per-device identity or rotation.
7. **No rate limiting** on report submission, replay, or sensor ingestion.
8. **No audit log for reads.** Only approve/reject decisions are recorded in `alert_approvals`.
9. **Service-role key has no least-privilege separation** between read-heavy endpoints and write paths.
10. **No automated security tests.**

## Reporting a security issue

This is a prototype with no published security contact. Raise issues through the repository's normal channel and do not include live credentials in reports.

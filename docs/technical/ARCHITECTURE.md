# Architecture

Describes the system **as it exists today**. No redesign.

## 1. Shape

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│  Browser (React SPA)        │  HTTP  │  FastAPI backend (/api prefix)       │
│  src/main.tsx → src/App.tsx │ ─────► │  server/app/main.py                  │
│  role workspaces, api.ts    │  JSON  │  routers under server/app/api/       │
└─────────────────────────────┘        │  services under server/app/services/ │
                                       └──────────────┬───────────────────────┘
                                                      │ supabase-py
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Supabase (Postgres + Auth)   │
                                       │ 15 tables, RLS not enforced │
                                       └──────────────────────────────┘
```

There is also a thin deployment shim, `api/index.py`, which puts `server/` on `sys.path` and re-exports `app.main:app` so the same FastAPI app can be served by a Vercel-style serverless entry point.

## 2. Frontend

- **Entry:** `src/main.tsx` → renders `src/App.tsx` in React `StrictMode`, registers `public/sw.js` when available.
- **Data layer:** all HTTP goes through `apiRequest()` in `src/api.ts`. Base URL is `VITE_API_BASE_URL`, defaulting to `http://127.0.0.1:8000/api` on localhost and `/api` elsewhere.
- **Shell / routing:** `src/App.tsx` owns the selected role, active basin, and active tab. There is no router library; the view is chosen by a ternary on `selectedRole` / `activeTab`.
- **Role workspaces:** `src/roleWorkspaces.tsx` maps a `RoleKey` to a page component.
- **Role metadata:** `src/config/roles.ts` (labels, descriptions, navigation) and `src/types/api.ts` (the `RoleKey` union).
- **Pages:** `AdminPage`, `DisasterAuthorityPage`, `VillageAuthorityPage`, `CommunityManagerPage`, `CommunityMemberPage`, plus Control Room subpages `InboundDataPage`, `VillageDeliveryPage`, `ConnectivityPage`. The Control Room command screen itself is implemented inline in `App.tsx`.
- **Styling:** `src/styles.css` (global) and `src/command-view.css` (Control Room).

## 3. Backend

`server/app/main.py` builds the FastAPI app, warms the Supabase clients at import time, installs CORS, and mounts every router under `/api`.

| Router | Prefix | Responsibility |
|---|---|---|
| `health.py` | `/api/health` | liveness |
| `admin.py` | `/api/admin` | read-only inventory and health |
| `android.py` | `/api/android` | Android relay endpoints |
| `auth.py` | `/api/auth` | current-user lookup |
| `rivers.py` | `/api/rivers` | basins, stations, villages |
| `hydro.py` | `/api/hydro` | station readings |
| `inbound.py` | `/api/inbound` | aggregated inbound evidence summary |
| `sensors.py` | `/api/sensors` | sensor ingestion (key-gated) |
| `community.py` | `/api/community` | report options, submission, lifecycle |
| `community_member.py` | `/api/community-member` | member summary, demo report, acknowledge |
| `alerts.py` | `/api/alerts` | active/detail/impact, approve/reject |
| `replay.py` | `/api/demo` | replay tick, river replay, step |
| `dashboard.py` | `/api/dashboard` | aggregate summary |
| `village_authority.py` | `/api/village-authority` | village-scoped summary, demo report |
| `connectivity.py` | `/api/connectivity` | reachability and delivery state |
| `village_delivery.py` | `/api/village-delivery` | per-village delivery matrix |

### Services

| Module | Responsibility |
|---|---|
| `services/rule_engine.py` | evidence gathering, 0–100 scoring, event + pending-alert creation, community ladder |
| `services/impact_engine.py` | per-village risk, risk level and ETA; persists `impact_assessments` |
| `services/replay_service.py` | 10s stream tick (all stations, DB cursor), single-river replay, single-step replay |
| `services/alert_service.py` | approval/rejection transitions and `alert_approvals` audit rows |

### Database access

`server/app/db/supabase.py` exposes two `lru_cache`d factories: `get_admin_client()` (service-role key, bypasses RLS) and `get_public_client()` (anon key, used for Auth token verification). The Supabase client is synchronous, so read endpoints that issue several queries offload them to a thread executor (see `dashboard.py`) to keep the event loop responsive.


## 4. Key data flows

### 4.1 Automatic stream (every 10 seconds)

1. `src/App.tsx` posts `POST /api/demo/replay/tick` on a 10s interval (first tick after one interval, not on mount).
2. `replay_tick()` enumerates basins and stations, derives each station's cursor from its latest `rule_evaluations` row, picks the next historical reading (wrapping), and scores it with the same `evaluate_hydro_reading()` used by live ingestion.
3. `build_impact_assessment()` recomputes village risk/ETA.
4. The response is stored per `station_code` in `streamSnapshot`; the active river renders from its entry.
5. The tick is guarded by an `asyncio.Lock` in `server/app/api/replay.py`: a concurrent caller gets `{coalesced: true}` rather than starting a second pass. The blocking evaluation runs via `asyncio.to_thread()` so ordinary read endpoints stay responsive while a tick is in progress.

### 4.2 Report lifecycle

Submit → `field-verify` (Community Manager) → `corroborate` (Village Authority) → `review` (Control Room) → alert approval (Disaster Authority). Each transition re-runs the rule engine for the affected station so the evidence score reflects the new state.

### 4.3 Alert authorization

Score ≥ 70 creates a `pending_approval` alert. The Disaster Authority's approve/reject route verifies the role, writes an `alert_approvals` audit row, and moves the alert status. The Control Room can review but not authorize.

## 5. Authentication flow

`server/app/auth/dependencies.py` provides:
- `get_current_user` — requires `Authorization: Bearer <token>`, verifies it with the public client, loads `user_profiles`, and rejects inactive/missing profiles.
- `require_roles(*roles)` — dependency factory enforcing allowed roles.

Authenticated routes use these dependencies. Demo routes (`/demo/*`, `*/demo/*`) intentionally bypass them for prototyping.

## 6. External services

| Service | Purpose | Notes |
|---|---|---|
| Supabase Auth | user identity and tokens | used by `get_current_user` |
| Supabase Postgres | all application data | accessed via supabase-py |
| CWC-derived historical CSV | seeded hydro readings | `server/data/wris_sample.csv` |

SACHET, Sentinel, satellite, Cell Broadcast, and LoRa integrations are idle/future scope.

## 7. Background work

There is no job queue or worker process. The "stream" is client-driven: the browser calls the tick endpoint on a timer. If no browser is open, no ticks occur.

## 8. Known architectural debt

- Demo and authenticated routes are duplicated across several routers, which invites drift.
- The stream depends on an open browser tab; a server-side scheduler would be more robust.
- Supabase client is synchronous, requiring manual thread offloading in a few endpoints.
- Row-level security is not relied upon; the service-role key bypasses it and authorization is enforced in Python.
- The Android relay app is not integrated with the backend's delivery pipeline.

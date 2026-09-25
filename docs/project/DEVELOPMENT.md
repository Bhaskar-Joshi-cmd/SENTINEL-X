# Development

## Before you change anything

This prototype has a **pytest suite for the scoring engine** but no frontend test runner. The safest loop is:

1. `npm run build` must pass (this runs `tsc -b`, so it is also the type check).
2. `cd server && .venv/bin/python -m pytest tests -q` must pass. These tests guard the scoring weights, risk bands, alert threshold and community ladder — if one fails, you have changed scoring behaviour.
3. `.venv/bin/python -m py_compile app/main.py app/api/*.py app/services/*.py` must pass for backend edits.
4. Restart uvicorn and exercise the affected endpoint with `curl`.
5. Reload the browser and check the page you changed, including its loading, empty, and error states.

There is no CI, so these local checks are the entire safety net.

## Layout conventions

| Directory | Contains |
|---|---|
| `src/` | React SPA. One page component per role/subpage, `api.ts` for all HTTP, `styles.css` + `command-view.css` for styling. |
| `server/app/api/` | One module per resource, each exposing a `router = APIRouter(prefix=...)`. |
| `server/app/services/` | Business logic: rule engine, impact engine, replay service, alert service. |
| `server/app/schemas/` | Pydantic request models. |
| `server/app/core/config.py` | Environment-backed settings. |
| `server/app/db/supabase.py` | Cached Supabase client factories. |
| `server/scripts/` | Hand-written SQL migrations. |
| `android/` | Separate Kotlin/Gradle offline-relay app. Not part of the web build. |
| `api/index.py` | Serverless shim that re-exports the FastAPI app. Do not delete. |
| `_handoff/` | Internal historical phase notes. Not user documentation. |

## Coding conventions actually followed

- TypeScript strict mode via `tsc -b` with project references.
- API response types live in `src/api.ts`; shared enums such as `RoleKey` live in `src/types/api.ts`.
- Role metadata is centralised in `src/config/roles.ts`; role→page mapping is centralised in `src/roleWorkspaces.tsx`.
- All backend HTTP calls go through the single `apiRequest<T>()` helper.
- Python: `from __future__ import annotations`, typed signatures, Pydantic models for request bodies, `HTTPException` for errors.
- Comments explain *why*, especially around the scoring ladder and the replay cursor.

There is no documented commit-message or branch convention. Inspect `git log` before assuming one.

## Backend development

```bash
cd server
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Supabase clients are cached with `lru_cache`; `server/app/main.py` warms them at import time so the first request is fast. The Supabase client is **synchronous**, so any endpoint issuing several queries should offload them to a thread executor (see `dashboard.py` for the pattern) instead of blocking the event loop.

## Frontend development

```bash
npm run dev
npm run dev -- --port 5178   # if 5173 is blocked locally
npm run build
npm run preview
```

The SPA has no router: `src/App.tsx` selects a view from `selectedRole` and `activeTab`. The role selector is a demo convenience, not an auth mechanism.

## Local debugging notes

- The 10-second stream is **client-driven**: it only advances while a browser tab is open and visible. If scores stop changing, check that a tab is active.
- Ticks are guarded by an `asyncio.Lock` in `server/app/api/replay.py`; a duplicate tab gets `{coalesced: true}` rather than a second evaluation.
- The replay cursor is derived from the database (the station's latest `rule_evaluations.hydro_reading_id`), so deleting recent evaluations rewinds the stream.
- Villages are cached in the SPA per basin (`villageCacheRef`) so basin switching does not blank the page.
- A full-screen "Connecting to SENTINEL-X…" loader appears only on first load; basin changes render immediately.
- `img.png` in the repo root is a project screenshot, not used by the app.

## Important Development Notes

- **Do not change the scoring weights or risk bands casually.** They are documented in `docs/product/PRD.md` §8 and implemented in `rule_engine.py`. A change there alters every alert decision.
- **The alert threshold is 70** (`ALERT_THRESHOLD`). Only `disaster_authority` and `admin` may approve an official alert; `control_room` is intentionally excluded.
- **Demo routes (`/demo/*`, `*/demo/*`) bypass authentication.** They are required for the prototype demo; do not assume they are protected.
- **`server/scripts/community_lifecycle_migration.sql` must be applied** to a fresh Supabase project or the verification lifecycle fails with a check-constraint error.
- **Community report `station_id` is nullable on purpose** — landslide and road-block reports have no hydro station.
- **Sensor station linkage is in `sensor_readings.raw_data.station_id`**, not a `station_id` column. Queries that assume a column will fail.
- **`api/index.py` is the deployment entry point** for serverless hosting. Removing it breaks that deployment path.
- **RLS is not used**; the service-role key bypasses it. Authorization lives in Python route dependencies.
- **Legacy components were removed.** `src/CommandViewPage.tsx` and `src/components/control-room/CommandView.tsx` were unreferenced duplicates of the live Control Room markup and have been deleted (recoverable from git history). The live Control Room lives in `src/App.tsx`.
- **The Android app is independent.** Changes there do not affect the web/backend and it has its own README.

## Performance work already done (do not regress)

- Supabase clients warmed at startup.
- `/dashboard/summary` batches and parallelises its queries in a thread executor.
- `/inbound/summary` filters by device/station in the database instead of post-filtering in Python.
- Community options are served from a module-level cache.
- Basin switching reuses cached villages and the already-loaded dashboard.
- The replay tick runs in a worker thread (`asyncio.to_thread`) so reads are not blocked.

If you add a slow endpoint, measure it during an active tick before shipping.

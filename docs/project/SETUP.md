# Setup

Everything needed to run SENTINEL-X locally.

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ (v25.8.2 used here) | frontend toolchain |
| npm | ships with Node | |
| Python | 3.12 (3.12.5 used here) | backend runtime |
| Supabase project | — | Postgres + Auth; the only external dependency |

No database needs to be installed locally; Supabase is hosted.

## 2. Install

### Frontend

```bash
cd /Users/bhaskarjoshi/Downloads/SIH/lastmile-resilience-dashboard
npm install
```

### Backend

```bash
cd /Users/bhaskarjoshi/Downloads/SIH/lastmile-resilience-dashboard/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

(`requirements.txt` exists at both the repo root and in `server/`; they are currently identical. Use the one in `server/`.)

## 3. Environment variables

The backend reads `server/.env` (create it; it is gitignored):

```ini
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

# Optional
SENSOR_INGEST_KEY=
REPLAY_STEP_DELAY_SECONDS=2.0
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

Never commit `.env`. `.env.example` in the repo root documents the frontend variable and is safe to copy.

The frontend needs only `VITE_API_BASE_URL`. It defaults to `http://127.0.0.1:8000/api` when the page is served from localhost, so local development usually needs nothing.

## 4. Database setup

1. Create a Supabase project.
2. Apply the migrations in the Supabase SQL Editor, in this order:
   - `server/scripts/community_schema_migration.sql` (baseline)
   - `server/scripts/community_lifecycle_migration.sql` (**required** for Community Manager / Village Authority verification to work)
3. Seed basins, stations, villages and hydro readings. `server/data/wris_sample.csv` contains CWC-derived sample readings.

Both scripts are idempotent (`IF EXISTS` / `IF NOT EXISTS`) and safe to re-run.

## 5. Run

Two terminals.

**Backend:**

```bash
cd /Users/bhaskarjoshi/Downloads/SIH/lastmile-resilience-dashboard/server
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API docs: <http://127.0.0.1:8000/docs>

**Frontend:**

```bash
cd /Users/bhaskarjoshi/Downloads/SIH/lastmile-resilience-dashboard
npm run dev
```

Open the printed URL (normally <http://localhost:5173/>).

### Serving the production build locally

```bash
npm run build          # tsc -b && vite build -> dist/
npm run preview        # Vite preview server
```

If Vite's dev server is blocked by a local firewall or port conflict, any static file server can host `dist/` instead (for example `python3 -m http.server 5186 --directory dist`). Note that a plain static server has no SPA history fallback, so deep links will 404 — navigate from `/`.

## 6. Verify the installation

```bash
# Backend is alive
curl -s http://127.0.0.1:8000/api/health

# Reference data loaded (should list TEESTA and DESANG)
curl -s http://127.0.0.1:8000/api/rivers

# The stream works (this writes evaluations to the database)
curl -s -X POST http://127.0.0.1:8000/api/demo/replay/tick
```

A healthy tick returns a JSON object with a `stations` array containing one entry per station (`reading`, `evaluation`, `impact_assessments`).

Build and type checks:

```bash
npm run build                       # includes tsc -b
cd server && .venv/bin/python -m py_compile app/main.py app/api/*.py app/services/*.py
```

## 7. Tests

A **pytest** suite covers the scoring engine's pure functions — no database required:

```bash
cd server && .venv/bin/python -m pytest tests -q
```

`server/tests/test_scoring.py` locks down the documented behaviour in `docs/product/PRD.md` §8: level/rate scoring bounds, risk bands and the 70-point alert threshold, hazard mapping, the graded community ladder (including "a single isolated report still scores +1" and "the same person never counts twice"), and the impact engine's risk-level helpers.

There is **no frontend test runner** configured yet. Frontend verification is by type-check and build.

## 8. Common problems

| Symptom | Cause | Fix |
|---|---|---|
| `401` on every authenticated route | Supabase keys missing/wrong in `server/.env` | Verify the three `SUPABASE_*` values |
| `503 ... rejects the lifecycle state 'field_confirmed'` | Lifecycle migration not applied | Run `server/scripts/community_lifecycle_migration.sql` |
| `401 Invalid sensor ingestion key` | `x-sensor-key` header missing or different from `SENSOR_INGEST_KEY` | Send the configured key (leave the setting empty to disable the check) |
| Frontend shows "Connecting to SENTINEL-X…" indefinitely | Backend unreachable | Confirm `curl http://127.0.0.1:8000/api/health`; check `VITE_API_BASE_URL` |
| Blank white screen in the browser | Serving `dist/` without an SPA fallback, or assets not rebuilt | Run `npm run build` again; navigate to `/` rather than a deep link |
| Vite dev server will not start / port blocked | Local firewall or port conflict | Use a different port (`npm run dev -- --port 5178`) or serve `dist/` statically |
| River switch feels slow | Old build still cached, or backend restarted without the threaded replay route | `npm run build`; restart uvicorn |
| `station_id` column error from sensor queries | A sensor select references a non-existent column | Sensor station linkage lives in `sensor_readings.raw_data.station_id`, not a column |
| No data changing in the dashboard | No browser tab open, or the stream request is failing | The stream is client-driven; open a tab and check the browser console |

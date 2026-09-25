# SENTINEL-X / CascadeGuard

Flood-hazard monitoring and last-mile warning prototype for two Himalayan river basins — **DESANG** (CWC Nanglamoraghat) and **TEESTA** (CWC Melli).

The system ingests hydrological observations plus community evidence, produces one explainable **0–100 risk score**, projects **per-village impact and time-to-impact**, and routes the warning through a human authorization chain before it can be dispatched.

![Project screenshot](img.png)

## Current status

Working prototype. All dashboards are functional and data-driven, a rule engine scores every observation, and a 10-second stream continuously re-evaluates both stations from the database.

**Known gaps:** Supabase login is not wired into the SPA (a demo role selector is used instead), official alert dispatch is not enabled, and the 10-second stream replays historical readings rather than live CWC data. See [`docs/product/PRD.md`](docs/product/PRD.md) for the full implemented/partial/planned breakdown.

## Main features

- **Rule engine** — 0–100 score from river level (60), rate of rise (20), sensor confirmation (10), community evidence (5) and persistence (5), with written reasons and risk bands. Alert recommendation begins at 70.
- **Dynamic village impact** — per-village risk score, risk level and ETA recomputed on every observation.
- **Automatic 10-second stream** — advances every station independently via a database-derived cursor and wraps at the end of history.
- **Six role workspaces** — Control Room, Disaster Authority, Village Authority, Community Manager, Community Member, System Admin.
- **Grounded report lifecycle** — report → field confirm (Community Manager) → corroborate (Village Authority) → review (Control Room) → **alert approval (Disaster Authority only)**.
- **Last-mile delivery model** — internet / cellular / offline relay paths with per-village delivery and acknowledgement state.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite, `lucide-react` icons, hand-written CSS |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Database | Supabase (PostgreSQL) via `supabase-py`; Supabase Auth |
| Mobile | Separate Kotlin/Gradle offline-relay app in `android/` |

No ORM, no router library, no state-management library, no test runner.

## Repository structure

```
├── src/                     React SPA (entry: src/main.tsx → src/App.tsx)
│   ├── api.ts               All HTTP calls (single apiRequest helper)
│   ├── config/roles.ts      Role metadata and navigation
│   ├── roleWorkspaces.tsx   Role → page mapping
│   ├── types/api.ts         RoleKey and shared types
│   └── *Page.tsx            One component per role/workspace
├── server/
│   ├── app/
│   │   ├── main.py          FastAPI app; routers mounted under /api
│   │   ├── api/             One router module per resource
│   │   ├── services/        rule_engine, impact_engine, replay_service, alert_service
│   │   ├── schemas/         Pydantic request models
│   │   ├── auth/            Bearer-token + role dependencies
│   │   ├── core/config.py   Environment settings
│   │   └── db/supabase.py   Cached Supabase clients
│   ├── scripts/             Hand-written SQL migrations
│   ├── data/                Seeded sample data
│   └── requirements.txt
├── api/index.py             Serverless shim re-exporting the FastAPI app
├── android/                 Separate Kotlin offline-relay app
├── docs/                    Product, technical and project documentation
├── _handoff/                Internal historical phase notes
└── dist/                    Build output (gitignored)
```

## Quick setup

**Prerequisites:** Node 18+, Python 3.12, a Supabase project.

```bash
# 1. Install
npm install
cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

# 2. Configure the backend — create server/.env with:
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# 3. Apply database migrations (Supabase SQL Editor, in order)
#   server/scripts/community_schema_migration.sql
#   server/scripts/community_lifecycle_migration.sql   <-- required
```

Full instructions, including seeding and troubleshooting: [`docs/project/SETUP.md`](docs/project/SETUP.md).

## Run

Two terminals:

```bash
# Backend
cd server && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Frontend
npm run dev
```

Then open the printed URL (normally <http://localhost:5173/>). API docs are at <http://127.0.0.1:8000/docs>.

## Environment configuration

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | `server/.env` | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | `server/.env` | yes | Public key, used for token verification |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/.env` | yes | **Bypasses RLS** — backend only, never expose to the frontend |
| `SENSOR_INGEST_KEY` | `server/.env` | no | Shared secret for `POST /api/sensors/readings` |
| `CORS_ORIGINS` | `server/.env` | no | Comma-separated allowed origins |
| `REPLAY_STEP_DELAY_SECONDS` | `server/.env` | no | Replay pacing (default `2.0`) |
| `VITE_API_BASE_URL` | frontend env | no | API base URL; defaults to `http://127.0.0.1:8000/api` on localhost, `/api` elsewhere |

`.env` files are gitignored; `.env.example` is tracked and contains placeholders only. See [`server/.env.example`](server/.env.example) for the backend template.

## Build and verify

```bash
npm run build                          # tsc -b + vite build
npm run typecheck                      # tsc -b --noEmit
cd server && .venv/bin/python -m py_compile app/main.py app/api/*.py app/services/*.py
cd server && .venv/bin/python -m pytest tests -q   # scoring-engine unit tests
curl -s http://127.0.0.1:8000/api/health               # backend alive
curl -s -X POST http://127.0.0.1:8000/api/demo/replay/tick   # stream works (writes to DB)
```

The scoring engine has a **pytest** suite in `server/tests/` covering the pure scoring functions without needing a database. There is **no frontend test runner** yet, so `npm run build` (which includes the type check) remains the frontend safety net.

## Documentation

| Document | Contents |
|---|---|
| [`docs/product/PRD.md`](docs/product/PRD.md) | What the product actually does today, personas, scoring model, limitations |
| [`docs/product/VISION.md`](docs/product/VISION.md) | Purpose, principles, long-term direction |
| [`docs/product/USER_STORIES.md`](docs/product/USER_STORIES.md) | Role-based user stories |
| [`docs/product/USE_CASES.md`](docs/product/USE_CASES.md) | Detailed interaction flows |
| [`docs/product/ROADMAP.md`](docs/product/ROADMAP.md) | Completed, in progress, planned, technical debt |
| [`docs/technical/ARCHITECTURE.md`](docs/technical/ARCHITECTURE.md) | Components, data flow, auth, architectural debt |
| [`docs/technical/TECH_STACK.md`](docs/technical/TECH_STACK.md) | Languages, frameworks, tooling, versions |
| [`docs/technical/API.md`](docs/technical/API.md) | Every endpoint with auth and parameters |
| [`docs/technical/DATABASE.md`](docs/technical/DATABASE.md) | Tables, relationships, constraints, migrations |
| [`docs/technical/SECURITY.md`](docs/technical/SECURITY.md) | Security model and known concerns |
| [`docs/project/SETUP.md`](docs/project/SETUP.md) | Installation, configuration, troubleshooting |
| [`docs/project/DEVELOPMENT.md`](docs/project/DEVELOPMENT.md) | Workflow, conventions, important warnings |
| [`docs/project/DEPLOYMENT.md`](docs/project/DEPLOYMENT.md) | Deployment options, migrations, rollback |
| [`CHANGELOG.md`](CHANGELOG.md) | Change history |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |

## Important development notes

- **Do not change scoring weights or risk bands casually** — they drive every alert decision. See `docs/product/PRD.md` §8.
- **Only `disaster_authority` and `admin` may approve an official alert.** Control Room is intentionally excluded.
- **Demo routes (`/demo/*`) bypass authentication.** Required for the prototype; must be gated before a real deployment.
- **`server/scripts/community_lifecycle_migration.sql` must be applied** or the verification lifecycle fails.
- **Sensor station linkage lives in `sensor_readings.raw_data.station_id`**, not a column.
- **`api/index.py` is the serverless entry point** — do not delete.
- **RLS is not used**; authorization is enforced in Python route dependencies.
- More detail in [`docs/project/DEVELOPMENT.md`](docs/project/DEVELOPMENT.md).

## Known limitations

- The 10-second stream replays historical data; there is no live CWC feed.
- Community evidence is a flat contribution per qualifying report, not a fully graded independent-corroboration ladder.
- Village ETA is a rise-rate approximation, not terrain/DEM flood routing.
- No Supabase Auth login in the SPA; role selection is a demo selector.
- No frontend test suite (the scoring engine is covered by pytest).

## License

No license file has been added. All rights reserved until the project owner chooses one — see [`CONTRIBUTING.md`](CONTRIBUTING.md).



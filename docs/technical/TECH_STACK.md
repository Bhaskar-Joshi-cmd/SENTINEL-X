# Tech Stack

Versions are those declared in the repository. `package.json` pins frontend dependencies as `"latest"`, so exact frontend versions resolve from `package-lock.json`; the ranges below reflect the declared intent.

## Frontend

| Technology | Version | Role |
|---|---|---|
| React | `latest` (lockfile-resolved) | UI runtime |
| React DOM | `latest` | DOM renderer |
| TypeScript | `latest` | type system, compiled with project references (`tsconfig.app.json`, `tsconfig.node.json`) |
| Vite | `latest` | dev server and production bundler |
| `@vitejs/plugin-react` | `latest` | React fast-refresh / JSX transform for Vite |
| `lucide-react` | `latest` | icon set |

No CSS framework, state-management library, or router is used. Styling is hand-written CSS; view switching is a conditional render in `src/App.tsx`.

Toolchain versions observed in this environment: **Node v25.8.2**.

## Backend

| Technology | Version | Role |
|---|---|---|
| Python | 3.12 (3.12.5 observed) | runtime |
| FastAPI | `>=0.115,<1.0` | web framework, OpenAPI docs at `/docs` |
| `uvicorn[standard]` | `>=0.30,<1.0` | ASGI server |
| `supabase` (supabase-py) | `>=2.6,<3.0` | PostgREST client + Auth |
| `pydantic-settings` | `>=2.6,<3.0` | env-var settings (`server/app/core/config.py`) |

Dependencies are declared twice and currently identical: `server/requirements.txt` (used with the backend venv) and the root `requirements.txt`.

## Database

| Technology | Role |
|---|---|
| Supabase (hosted PostgreSQL) | all application data, 15 tables |
| Supabase Auth | user identity and bearer tokens |

There is no ORM and no migration framework. Schema changes are hand-written SQL in `server/scripts/*.sql` and applied manually in the Supabase SQL Editor.

## External services

- **CWC-derived historical data** seeded into `hydro_readings` (sample at `server/data/wris_sample.csv`).
- SACHET, Sentinel, satellite, Cell Broadcast and LoRa integrations are **not implemented** in this prototype.

## Build and tooling

| Command | Effect |
|---|---|
| `npm run dev` | Vite dev server with `--host` |
| `npm run build` | `tsc -b` then `vite build` → `dist/` |
| `npm run preview` | serve the production build locally |
| `.venv/bin/uvicorn app.main:app` | run the API |
| `.venv/bin/python -m py_compile <files>` | backend syntax check |

There is **no automated test runner** configured (no Jest/Vitest/pytest dependency, no `test` script). Verification is done by type-check + build + `py_compile` + manual HTTP smoke tests.

## Deployment targets

- **Frontend:** static `dist/` on any static host, or Vercel.
- **Backend:** any ASGI host, or Vercel serverless via the `api/index.py` shim.
- No CI/CD pipeline, containerization, or infrastructure-as-code is present in the repository.

## Android

`android/` is a separate Gradle/Kotlin project (an offline-relay client). It is not part of the web/backend build and has its own README.

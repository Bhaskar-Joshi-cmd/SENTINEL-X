# Deployment

## Current state

There is **no automated deployment pipeline** in this repository — no CI/CD workflow, no containers, no infrastructure-as-code. The project is run manually. What follows describes the two supported shapes based on files that exist in the repo.

## Option A — Split hosting (frontend static, backend ASGI)

### Frontend

```bash
npm ci
npm run build          # emits dist/
```

Deploy `dist/` to any static host (Vercel static, Netlify, S3 + CloudFront, nginx). The SPA has no server-side routing, so no rewrite rules are needed for the root path.

If the frontend and API are on different origins, set `VITE_API_BASE_URL` **at build time** to the backend's public `/api` URL, and add that origin to the backend's `CORS_ORIGINS`.

### Backend

```bash
cd server
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run it under a process supervisor (systemd, launchd, pm2, or a container platform). Required environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Optional: `SENSOR_INGEST_KEY`, `CORS_ORIGINS`, `REPLAY_STEP_DELAY_SECONDS`.

## Option B — Single serverless deployment (Vercel)

`api/index.py` is the serverless entry point. It inserts `server/` onto `sys.path` and re-exports `app.main:app`, so the same FastAPI application is served as a function.

- The frontend is the Vite build at the repo root.
- Set `VITE_API_BASE_URL=/api` so the SPA calls the same origin.
- Add the deployment URL to `CORS_ORIGINS` if it is not localhost.

There is no `vercel.json` in the repository, so provider configuration (build command, output directory, Python runtime) must be supplied through the hosting dashboard.

## Database migrations

Migrations are **manual**. There is no migration runner and no version table.

1. Open the Supabase SQL Editor.
2. Run `server/scripts/community_schema_migration.sql`.
3. Run `server/scripts/community_lifecycle_migration.sql`.

Both are idempotent, so re-running is safe. Run them before deploying a frontend that uses the verification lifecycle; otherwise those actions fail with HTTP `503` naming the missing migration.

**Migration policy:** schema changes ship as a new numbered SQL file in `server/scripts/`. Never edit the schema from the dashboard without recording it in a script.

## Rollback

- **Frontend:** redeploy the previous build output. `dist/` is not committed, so rebuild from the previous commit.
- **Backend:** redeploy the previous revision and restart the service.
- **Database:** the migration scripts are additive or constraint replacements. Rolling back the application does not require reverting them — the new columns and the widened CHECK constraint are backwards compatible. Avoid writing `DROP COLUMN` migrations without a stated reason.

## Pre-deployment checklist

- [ ] `npm run build` passes.
- [ ] `.venv/bin/python -m py_compile app/main.py app/api/*.py app/services/*.py` passes.
- [ ] Both SQL migrations applied to the target Supabase project.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set on the backend only, never in frontend env.
- [ ] `CORS_ORIGINS` pinned to real origins (remove reliance on the localhost regex).
- [ ] Demo routes removed or gated if this is a real deployment.
- [ ] `SENSOR_INGEST_KEY` set to a strong value, or sensor ingestion disabled.
- [ ] `GET /api/health` returns 200 from the deployed backend.
- [ ] `POST /api/demo/replay/tick` verified **only** on a demo environment (it writes to the database).

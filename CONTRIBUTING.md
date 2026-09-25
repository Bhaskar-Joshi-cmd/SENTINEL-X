# Contributing

Thanks for helping improve SENTINEL-X / CascadeGuard. This is a prototype, so the most valuable contributions are correctness fixes, documentation improvements, and closing the known gaps listed in [`docs/product/ROADMAP.md`](docs/product/ROADMAP.md).

## Before you start

Read these first — they save a lot of wasted effort:

- [`docs/technical/ARCHITECTURE.md`](docs/technical/ARCHITECTURE.md) — how the system fits together
- [`docs/technical/API.md`](docs/technical/API.md) — every endpoint
- [`docs/project/DEVELOPMENT.md`](docs/project/DEVELOPMENT.md) — workflow, conventions, and the warnings below
- [`docs/technical/SECURITY.md`](docs/technical/SECURITY.md) — the security model and its gaps

## Ground rules

1. **Do not change the scoring weights or risk bands casually.** They drive every alert decision and are documented in `docs/product/PRD.md` §8. If you believe a weight is wrong, open an issue and explain the reasoning first.
2. **Preserve the human-in-the-loop boundary.** Only `disaster_authority` and `admin` may approve an official alert. Community reports contribute evidence; they must never auto-trigger an alert.
3. **Never commit secrets.** `.env` files are gitignored. Use `.env.example` to document new variables.
4. **Database changes ship as SQL.** Add a new file in `server/scripts/` rather than altering the schema from the dashboard. All statements must be idempotent.
5. **Frontend role hiding is not authorization.** If an action is privileged, enforce it in a FastAPI route dependency.

## Setting up

Follow [`docs/project/SETUP.md`](docs/project/SETUP.md). In short:

```bash
npm install
cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

You will also need a Supabase project with both migrations from `server/scripts/` applied.

## Verifying your change

There is no automated test suite yet, so these checks are the safety net. All of them must pass:

```bash
# Frontend type-check and production build
npm run build

# Backend syntax check
cd server && .venv/bin/python -m py_compile app/main.py app/api/*.py app/services/*.py

# Runtime checks
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/rivers
curl -s -X POST http://127.0.0.1:8000/api/demo/replay/tick
```

Then load the app in a browser and exercise the page you changed, including its loading, empty, and error states.

### Performance

The dashboard was made fast by moving blocking Supabase work off the event loop. If you add an endpoint, measure it **while a replay tick is running** — that is when contention shows up:

```bash
# Start a tick in the background, then time a read concurrently
curl -s -o /dev/null -w '%{time_total}\n' -X POST http://127.0.0.1:8000/api/demo/replay/tick &
curl -s -o /dev/null -w 'read during tick: %{time_total}s\n' http://127.0.0.1:8000/api/dashboard/summary
```

Any read that jumps to multiple seconds while a tick is in progress needs the same treatment `dashboard.py` uses (thread executor) rather than a frontend workaround.

## Style

Follow the conventions already in the code rather than introducing new ones:

- **TypeScript:** strict mode via `tsc -b`; response types in `src/api.ts`; shared enums in `src/types/api.ts`; role metadata in `src/config/roles.ts`; role→page mapping in `src/roleWorkspaces.tsx`.
- **Python:** `from __future__ import annotations`, typed signatures, Pydantic models for request bodies, `HTTPException` for errors.
- **Comments:** explain *why*, especially around the scoring ladder, the replay cursor, and the authorization boundary.

## Commits and branches

No formal convention is in use. Keep commits focused, and write messages that describe the behaviour change rather than the files touched. Do not commit build output (`dist/`, `android/**/build/`) or environment files.

## Pull requests

1. Ensure every verification command above passes.
2. Update the relevant document in `docs/` — behaviour changes should be reflected in `docs/technical/API.md`, `docs/technical/DATABASE.md`, or `docs/product/PRD.md`.
3. Add an entry to the `[Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md).
4. Describe what you changed, why, and how you verified it.

## Adding tests

There is no test runner yet. Introducing one (Vitest for the frontend, pytest for the backend) would be a valuable contribution. If you add one, wire it into `package.json` and `server/requirements.txt` and document the commands in `docs/project/DEVELOPMENT.md`.

## Reporting bugs

Open an issue with:

- what you did, what you expected, and what happened
- the basin and role you were using
- browser console and backend log output
- your Node, Python, and Supabase setup

Never include credentials or access tokens in an issue.

## Security issues

Do not open a public issue for a security vulnerability. See the reporting note at the end of [`docs/technical/SECURITY.md`](docs/technical/SECURITY.md).

## License

No license has been chosen for this project. Until the project owner adds one, no one may redistribute or publish the code. If you need a license for your work, ask the project owner first.

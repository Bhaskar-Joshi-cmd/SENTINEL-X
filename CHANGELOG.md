# Changelog

All notable changes to SENTINEL-X / CascadeGuard are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Because the project has no release tags yet, entries describe the current working prototype rather than published versions.

## [Unreleased]

The current working state. No version has been formally released.

### Added

- **Rule engine** (`server/app/services/rule_engine.py`) — 0–100 hazard score from river level (60), rate of rise (20), sensor confirmation (10), community evidence (5) and persistence (5), with human-readable reasons, risk bands, and an alert threshold of 70.
- **Dynamic impact engine** (`server/app/services/impact_engine.py`) — per-village risk score, risk level and time-to-impact recomputed from the current reading, replacing an earlier static formula.
- **Automatic 10-second stream** (`server/app/services/replay_service.py`, `server/app/api/replay.py`) — advances every station in both basins via a database-derived cursor and wraps at the end of history.
- **Community report lifecycle** — `field-verify` (Community Manager), `corroborate` (Village Authority, own village only), and `review` (Control Room) endpoints, plus `server/scripts/community_lifecycle_migration.sql` for the new status vocabulary and indexes.
- **Community Manager role and workspace** (`src/CommunityManagerPage.tsx`) — field confirmation/dispute desk.
- **Disaster Authority alert authorization** — approve/reject with an `alert_approvals` audit trail; Control Room is deliberately excluded from approving official alerts.
- **Persisted community-member acknowledgement** via `POST /api/community-member/demo/acknowledge`.
- **Sensor ingestion UI** on the Inbound Data page, calling the existing key-gated `POST /api/sensors/readings`.
- **System Admin read-only panel** (`src/AdminPage.tsx`, `GET /api/admin/summary`).
- **Android relay app** (`android/`) — separate offline-relay client.
- **Serverless entry shim** (`api/index.py`) re-exporting the FastAPI app.
- **Documentation set** under `docs/` (product, technical, project) plus `CHANGELOG.md` and `CONTRIBUTING.md`.
- **Repository hygiene** — `.env.example` templates for frontend and backend containing no real credentials.

### Changed

- **Impact scoring** now derives from the actual rule-engine score, station thresholds, village vulnerability and downstream position, instead of a fixed `92 - index*9` formula. Village risk and ETA update on every replayed observation.
- **Village impact is returned on every replay step**, even when no alert or event exists, so basins without an active alert (for example Melli) still show risk and time-to-impact.
- **Scoring reads live evidence from the database** each evaluation (`get_station_evidence`): sensor readings and community reports for the station, within the current event window, capped at 20 relevant records.
- **Frontend river switching** reuses the already-loaded dashboard and a per-basin village cache, so switching no longer blanks the page behind a full-screen loader.
- **Stream scheduling** starts after the first 10-second interval rather than on mount, so first paint is not competing with a two-station evaluation pass.
- **Replay tick runs in a worker thread** (`asyncio.to_thread`) so ordinary read endpoints are not blocked by a long evaluation pass.
- **Duplicate replay ticks are coalesced** with an `asyncio.Lock`; a concurrent caller receives `{coalesced: true}` instead of starting a second pass.

### Fixed

- **Replay route syntax** — the tick handler previously used `await` inside a synchronous function, which failed to compile and would have prevented a clean backend restart.
- **Melli impact data** — impact previews are now returned for stations without an event, so the affected-village table and time-to-impact are populated.
- **Risk label consistency** — preview-only risk levels (`moderate`, `low`) are mapped to their displayed bands so a numeric score never appears beside an incorrect `NORMAL` label.
- **Sensor query correctness** — sensor station linkage is read from `sensor_readings.raw_data.station_id`; the previous query referenced a non-existent column.
- **Rule engine stability** — several latent `NameError`/`UnboundLocalError` paths in the community evidence block were corrected.
- **Event windowing** — the community evidence window now starts at the active hazard event rather than the previous evaluation timestamp, so evidence is no longer dropped between ticks.
- **Impact engine null-safety** — calling the impact engine with only an event id no longer raises `AttributeError`.
- **Latency** — measured basin switching during an active stream tick went from approximately 15 seconds to under 1.5 seconds.

### Security

- Alert approval is restricted to `disaster_authority` and `admin`; the Control Room cannot authorize an official alert.
- Village Authority corroboration verifies the caller's village matches the report.
- Sensor ingestion requires the `x-sensor-key` header when a key is configured.

Remaining gaps are documented in [`docs/technical/SECURITY.md`](docs/technical/SECURITY.md) — most importantly, demo routes intentionally bypass authentication and Row Level Security is not used.

### Removed

- Untracked development backups (`*.before-replay-ui`, `*.before-vercel-fix`, `*.before-command-rebuild`, `*.before-replay-step`, `*.before-fastapi`), a stray `nohup.out`, an unreferenced ad-hoc probe script, and generated Android build output under `android/C:/`. No tracked production code, migration, or configuration was removed.

### Known limitations

- Supabase Auth login is not wired into the SPA; the role selector is a demo convenience.
- Official alert dispatch is not enabled.
- The stream replays historical readings; there is no live CWC feed.
- There is no frontend test suite; the scoring engine is covered by pytest in `server/tests/`.

### Tests

- **Scoring engine unit tests** — `server/tests/test_scoring.py` (pytest, no database required) covering the river-level and rate factors, risk bands, the 70-point alert threshold, the hazard mapping, the graded community ladder, and the impact engine's risk-level helpers. Run with `cd server && .venv/bin/python -m pytest tests -q`.

### Removed (dead code)

- `src/CommandViewPage.tsx`, `src/components/control-room/CommandView.tsx` and its CSS — unreferenced duplicates of the live Control Room markup, not imported anywhere. Recoverable from git history.
- `android/C:/lastmile-android-build/` — a Windows build-output directory accidentally committed to version control.

- **Dashboard summary** batches and parallelises its Supabase queries in a thread executor.
- **Inbound summary** filters sensor and evaluation queries in the database rather than post-filtering in Python.
- **Community options** are served from a module-level cache.
- **Supabase clients are warmed at application startup** so the first request does not pay client initialisation cost.

# Roadmap

Assumptions are not commitments. "Planned" reflects intent recorded in code comments and design discussions; "Future ideas" is speculation.

## Completed

- Two-basin data model (DESANG/Nanglamoraghat, TEESTA/Melli) with stations, villages, hydro readings.
- Rule engine: 0–100 score from river level (60), rate of rise (20), sensor (10), community (5), persistence (5), with written reasons and risk bands.
- Alert threshold at 70; `pending_approval` alert creation; P0/P1 priority mapping.
- Dynamic village impact engine (risk score, risk level, ETA) replacing the previous static formula.
- Automatic 10-second stream that advances every station via a DB-derived cursor and wraps at the end of history.
- Control Room pages: Command View, Inbound Data, Village Delivery, Connectivity, Audit.
- Disaster Authority, Village Authority, Community Manager, Community Member, and System Admin panels.
- Community report lifecycle endpoints (submit, field-verify, corroborate, review) and the lifecycle SQL migration.
- Persisted community-member acknowledgement via `alert_deliveries.acknowledged_at`.
- Sensor ingestion endpoint with API-key gate and score contribution.
- Backend latency work: Supabase client warm-up, batched dashboard query, scoped inbound queries, cached community options, threaded replay tick with duplicate coalescing.
- Read-only System Admin health/inventory panel.

## In progress

- Supabase Auth login in the SPA (backend dependency and role gate are complete; the client login flow is not).
- Protected alert approval and real dissemination/delivery tracking.

## Planned

- Replace the historical replay stream with live CWC/relay ingestion.
- Per-village message/relay triggering driven by impact rows (hook marked with `# TODO(delivery)` in `replay_service.py`).
- Enforce `user_profiles.village_id` so Village Authority and Community Manager actions cannot cross village boundaries without the demo selector.
- Connection pooling / read replicas if Supabase latency becomes a bottleneck at higher load.

## Known technical debt

- No automated frontend test suite; the scoring engine is covered by a pytest suite in `server/tests/`.
- Demo and authenticated routes are duplicated in several files (`community.py`, `alerts.py`, `community_member.py`), which risks drift.
- Connectivity page still uses local React booleans as if authoritative.
- Demo routes remain unauthenticated by design; they must be gated before any real deployment.
- Row Level Security is not enabled; authorization is enforced in Python only.

## Future ideas

- Terrain/DEM-based flood propagation for ETA instead of the rise-rate approximation.
- Multi-basin river-network modelling beyond the two seeded stations.
- Real offline mesh relay telemetry from the Android app.
- Satellite and Cell Broadcast integrations (explicitly idle in this prototype).

# Product Requirements Document — SENTINEL-X / CascadeGuard

> Status: describes the **current** system. Sections are labelled Implemented / Partial / Planned / Limitation so nothing here is mistaken for a commitment.

## 1. Product overview

SENTINEL-X (internally "CascadeGuard") is a flood-hazard monitoring and last-mile warning prototype for two Himalayan river basins:

- **DESANG** — monitored by station `CWC_NANGLAMORAGHAT`
- **TEESTA** — monitored by station `CWC_MELLI`

The system ingests hydrological observations plus community evidence, scores hazard risk with a deterministic rule engine, projects downstream village impact, and moves a warning through a human-authorization chain before it can be dispatched.

A web dashboard (React SPA) and a Python API (FastAPI + Supabase Postgres) implement the flow. An Android app under `android/` is a separate offline-relay client and is not part of the main data path.

## 2. Problem being solved

Flood warnings in remote Himalayan valleys fail when the network fails, not when the data is missing. A single alert that depends on continuous connectivity does not survive the outage it is meant to warn about. SENTINEL-X addresses the coordination and last-mile problem:

1. Combine technical signals (water level, rate of rise, field sensors) with local human reports.
2. Produce one explainable 0–100 risk score per station reading.
3. Project impact (risk, ETA, population) for downstream villages.
4. Keep a human authorization boundary before any official warning.
5. Model delivery across internet / cellular / offline relay paths.

## 3. Target users and personas

Roles are configured in `src/config/roles.ts` and enforced in `server/app/auth/dependencies.py`.

| Role | Who they are | Can do |
|---|---|---|
| **Control Room / DEOC** | Operational monitoring team | Verify and correlate evidence, review inbound data, run the rule engine, produce an **alert recommendation** |
| **Disaster Authority** | Authorized district disaster-management (DDMA-side) official, configured per deployment | **Approve / reject the official alert**, target villages, authorize dissemination |
| **Village Authority** | Designated representative of the village / Gram Panchayat / VDMC | Corroborate the local situation, review field confirmations, coordinate/acknowledge the local response |
| **Community Manager** | Designated trained local field POC / volunteer (Aapda-Mitra type) | Field-confirm or dispute village reports, add field comments/evidence, view local hazard and relay status |
| **Community Member** | Ordinary resident / local observer | Submit a report, view own submissions, view and acknowledge the village warning |
| **System Admin** | Platform operator | Read-only health, data inventory, role directory |

## 4. Product goals

1. One explainable score per station observation, traceable to its five weighted factors.
2. Dynamic (not static) per-village risk and time-to-impact derived from the current reading.

## 5. Current features

### 5.1 Implemented

| Feature | Where |
|---|---|
| Rule engine, 0–100 score with 5 weighted factors and written reasons | `server/app/services/rule_engine.py` |
| Dynamic village impact (risk score, risk level, ETA) | `server/app/services/impact_engine.py` |
| Automatic 10-second stream advancing every station via a DB cursor | `server/app/services/replay_service.py`, `server/app/api/replay.py` |
| Control Room: Command View, Inbound Data, Village Delivery, Connectivity, Audit | `src/App.tsx`, `src/InboundDataPage.tsx`, `src/VillageDeliveryPage.tsx` |
| Disaster Authority alert review and approve/reject | `src/DisasterAuthorityPage.tsx`, `server/app/api/alerts.py` |
| Village Authority corroboration | `src/VillageAuthorityPage.tsx`, `server/app/api/community.py` |
| Community Manager field-confirm / dispute | `src/CommunityManagerPage.tsx`, `server/app/api/community.py` |
| Community Member report submission + persisted acknowledgement | `src/CommunityMemberPage.tsx`, `server/app/api/community_member.py` |
| System Admin read-only health/inventory panel | `src/AdminPage.tsx`, `server/app/api/admin.py` |
| Sensor ingestion (API-key gated) | `server/app/api/sensors.py` |
| Basins, stations, villages, hydro readings, connectivity summaries | `server/app/api/rivers.py`, `server/app/api/hydro.py`, `server/app/api/connectivity.py` |
| Per-village role summaries and delivery state | `server/app/api/village_authority.py`, `server/app/api/village_delivery.py` |
| Supabase Auth token verification + role gate (dependency implemented) | `server/app/auth/dependencies.py` |

### 5.2 Partially implemented

- **Authentication.** `get_current_user` and `require_roles` are implemented and enforced on the authenticated routes, and `GET /api/auth/me` exists, but the SPA does not yet perform a Supabase login. The role switcher in the UI is a **demo selector**, and most user-facing flows call `*/demo/*` endpoints that bypass the token check.
- **Alert approval.** The approve/reject routes and the `alert_approvals` audit trail work, but the official public-warning dispatch step is explicitly marked as the next phase.
- **Connectivity simulation.** `src/App.tsx` still keeps local `networks` booleans for UI simulation; the backend `connectivity/summary` exists but the network-twin controls are not authoritative.
- **Village scoping.** `user_profiles.village_id` is returned by the auth dependency, but the demo pages let the user pick a village instead of enforcing the assignment.

### 5.3 Planned

- Supabase Auth login and role-driven routing (replacing the demo selector).
- Protected alert approval and real dissemination/delivery tracking.
- Real sensor/relay ingestion replacing the historical replay stream.
- Live per-village message/relay triggering driven by the impact rows (a `# TODO(delivery)` hook is marked in `replay_service.py`).

### 5.4 Known limitations

- The 10-second stream replays **historical** readings; there is no live CWC feed. The UI labels it `HISTORICAL DATA REPLAY`.
- Community evidence is graded across the current event window (up to 20 relevant reports) using the ladder above; a single report is never ignored, and a person confirming their own report adds nothing.
- Impact ETA is a model-derived estimate (head-room to danger/HFL divided by observed rise rate, plus a downstream distance factor), not a terrain/DEM flood-routing result.
- There is no automated test suite in the repository. Verification has been done by `npm run build`, `py_compile`, and manual HTTP smoke tests.

## 6. Functional requirements (as built)

1. Every station observation produces a 0–100 score, a risk level, a priority, and human-readable reasons.
2. Village impact is recomputed per observation, not fixed.
3. A 10-second automatic stream advances each station independently and wraps at the end of its history.
4. Report, field verification, corroboration, and alert approval are separate actions with different role permissions.
5. Backend role checks are authoritative; frontend hiding is UX only.
6. Historical/replayed data is never labelled as live.

## 7. Non-functional requirements

- Human-in-the-loop: no automated public dispatch.
- Explainability: every score carries its contributing factors and reasons.
- No hardcoded operational values in a completed page.
- Loading, empty, and error states are first-class UI states.

## 8. Scoring model (current implementation)

| Factor | Max | Rule |
|---|---:|---|
| River level | 60 | 0 below warning; 20→60 interpolated warning→danger; 40→60 danger→HFL; 60 at/above HFL |
| Rate of rise | 20 | 0 at/below 0; 10 for >0 and ≤0.02 m/hr; 20 for >0.02 m/hr |
| Sensor confirmation | 10 | `water_level` sensor ≥ station warning level = 10; `seismic`/`vibration`/`camera` = 5; none = 0 |
| Community evidence | 5 | Graded ladder: +1 first valid hazard report, +1 second independent reporter, +2 Community Manager field confirmation, +1 Village Authority corroboration. A single isolated report still scores +1, and the same person never counts twice. |
| Persistence | 5 | previous two readings also at/above warning = 5; otherwise 0 |

Total is capped at 100. Bands: `normal` <25, `watch` <50, `warning` <70, `high` <85, `critical` ≥85. Alert recommendation begins at **70** (`ALERT_THRESHOLD`), producing a `pending_approval` alert (P1 for high, P0 for critical).

## 9. Out of scope for this prototype

SACHET and Sentinel ingestion, satellite feeds, real Cell Broadcast, real LoRa hardware communication, terrain/DEM flood routing, and a public dissemination gateway.

## 10. Where to look next

- API surface: `docs/technical/API.md`
- Schema and constraints: `docs/technical/DATABASE.md`
- Running it: `docs/project/SETUP.md`
- Change history: `CHANGELOG.md`

3. Clear separation of **report → verification → alert approval** with different actors.
4. Graded community evidence (0–5) that rewards independent corroboration without requiring it.
5. A visible, non-destructive live-data simulation for demos.

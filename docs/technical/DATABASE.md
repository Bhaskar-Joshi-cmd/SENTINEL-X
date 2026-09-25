# Database

- **Technology:** Supabase (hosted PostgreSQL) + Supabase Auth.
- **Access:** `server/app/db/supabase.py` via the `supabase` Python client. No ORM, no query builder abstraction, no migration framework.
- **Identifiers:** UUID primary keys throughout.
- **Timestamps:** `timestamptz`.

## Tables

The authoritative list (from `docs/PHASE_0_DB_UI_MAP.md`, cross-checked against table names used in code):

| Table | Purpose | Key relationships |
|---|---|---|
| `basins` | River basins (`TEESTA`, `DESANG`) | parent of stations and villages |
| `hydro_stations` | Monitoring stations with warning/danger/HFL thresholds | `basin_id → basins` |
| `hydro_readings` | Historical/live water level + rate per station | `station_id → hydro_stations` |
| `sensor_devices` | Field sensor registry (type, code) | referenced by `sensor_readings.sensor_id` |
| `sensor_readings` | Sensor measurements; station link lives in `raw_data.station_id` | `sensor_id → sensor_devices` |
| `community_reports` | Citizen/field reports with verification lifecycle | `village_id → villages`, nullable `station_id → hydro_stations`, nullable `reporter_user_id → auth.users` |
| `rule_evaluations` | One scored evaluation per reading, with factor breakdown, reasons, and an `input_snapshot` | `hydro_reading_id`, optional `event_id` |
| `events` | Hazard events (flash flood etc.) with confidence and status | `basin_id → basins` |
| `event_observations` | Links events to supporting observations | `event_id → events` |
| `villages` | Downstream villages with population, vulnerability, coordinates | `basin_id → basins` |
| `impact_assessments` | Per-village risk score, risk level, ETA, downstream order | `event_id → events`, `village_id → villages` |
| `alerts` | Warning records with priority/urgency/severity and status | `event_id → events` |
| `alert_targets` | Per-village alert targeting | `alert_id → alerts`, `village_id → villages` |
| `alert_deliveries` | Delivery attempts and acknowledgements per channel | `alert_id`, `village_id` |
| `alert_approvals` | Audit trail of approve/reject decisions | `alert_id → alerts` |
| `user_profiles` | Role, name, and village assignment per Supabase user | `id → auth.users`, `village_id → villages` |

## Important constraints

- `community_reports.verification_status` — CHECK allows: `pending` (legacy alias of `submitted`), `submitted`, `field_confirmed`, `not_confirmed`, `corroborated`, `verified`, `rejected`, `incorporated` (legacy only).
- `user_profiles.role` — CHECK allows: `admin`, `control_room`, `disaster_authority`, `village_authority`, `community_manager`, `community_member`, `observer`.
- `community_reports.station_id` is **nullable** by design: non-river reports (landslide, blocked route) legitimately have no station.
- `alert_deliveries.is_simulated` defaults to `TRUE`; the current prototype does not send real messages.

## Indexes

Defined in the migration scripts:

- `idx_community_reports_station_time` — `(station_id, submitted_at DESC)`
- `idx_community_reports_village_time` — `(village_id, submitted_at DESC)`
- `idx_community_reports_reporter` — `(reporter_user_id)`
- `idx_community_reports_submitted_at` — `(submitted_at DESC)`, added for the Inbound/recent-reports read path

## Migration strategy

There is **no automated migration runner**. Schema changes are hand-written SQL applied manually in the Supabase SQL Editor. All statements use `IF EXISTS` / `IF NOT EXISTS` so they are safe to re-run.

| Script | Purpose | Required when |
|---|---|---|
| `server/scripts/community_schema_migration.sql` | Baseline: role constraint, `reporter_user_id`, nullable `station_id`, `alert_deliveries.is_simulated`, `hydro_readings.replayed_at`, first indexes | Before using the community login API |
| `server/scripts/community_lifecycle_migration.sql` | Lifecycle vocabulary (`field_confirmed`/`not_confirmed`/`corroborated`), nullable `station_id`, `community_manager` role, remaining indexes | **Required** before Community Manager field-confirm and Village Authority corroborate will work |

The lifecycle migration is mandatory: the original CHECK constraint predates the newer states, so those transitions fail with a database check-constraint error (surfaced as HTTP `503` naming the migration) until it is applied.

### Applying a migration

1. Open the Supabase dashboard → SQL Editor.
2. Paste the script contents.
3. Run. The script is idempotent.

## Row Level Security

RLS is **not** relied upon by the backend. All data access uses the service-role key, which bypasses RLS; authorization is enforced in Python via `require_roles` and explicit village checks. This is acceptable for a prototype but is listed as security debt in [`SECURITY.md`](./SECURITY.md).

## Seed data

`server/data/wris_sample.csv` holds CWC-derived sample readings used to seed `hydro_readings` for the two stations. Station row counts differ (Melli has more observations than Nanglamoraghat), which is why the stream cycles the shorter station more frequently — this is expected, not a bug.

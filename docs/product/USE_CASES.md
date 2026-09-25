# Use Cases

Each use case lists actor, preconditions, main flow, alternative flows, and expected result. Paths reference real files.

---

## UC-01 — Automatic stream tick updates the operational picture

- **Actor:** Browser (any open dashboard tab) → `POST /api/demo/replay/tick`
- **Preconditions:** Historical readings exist for the stations; the backend is running.
- **Main flow:**
  1. The SPA timer (10s) posts a tick.
  2. `replay_tick()` walks every basin and every station.
  3. For each station it reads the historical readings, derives a cursor from the station's latest `rule_evaluations.hydro_reading_id`, and picks the next reading (wrapping at the end).
  4. `evaluate_hydro_reading()` scores it (level, rate, sensor, community, persistence) and may create/update an event and a pending alert.
  5. `build_impact_assessment()` recomputes village risk/ETA and persists them.
  6. The response returns one entry per station; the SPA stores it per `station_code`.
- **Alternative flows:**
  - A station has no historical readings → that station returns an `error` string; the tick still succeeds for others.
  - A second tab calls while a tick is running → the backend returns `{ "coalesced": true }` instead of starting a second pass.
- **Expected result:** Scores and village impact change per tick; the displayed river updates every 10 seconds without a page reload.

---

## UC-02 — Community Member submits a hazard report

- **Actor:** Community Member
- **Preconditions:** A village and station are selected.
- **Main flow:**
  1. The member picks report type, severity, and an optional description.
  2. The SPA posts to `POST /api/community-member/demo/reports`.
  3. The backend inserts into `community_reports` (status `submitted`/legacy `pending`), resolves the relevant station for river-type reports, and calls `evaluate_community_report()` so the evidence is scored immediately.
- **Alternative flows:** A non-river report (e.g. landslide) is stored with `station_id = NULL`.
- **Expected result:** The report appears in Control Room Inbound Data and in the Community Manager's field queue; the next stream tick can count it as community evidence.

---

## UC-03 — Community Manager field-confirms a report

- **Actor:** Community Manager
- **Preconditions:** A report exists for the manager's village.
- **Main flow:**
  1. The manager opens the Field Desk and selects a report.
  2. They choose Confirm or Dispute and may add field comments/evidence.
  3. The SPA posts to `POST /api/community/reports/{id}/field-verify` (or its `/demo/` equivalent).
  4. The backend sets `verification_status` to `field_confirmed` or `not_confirmed` and stamps the verifier.
  5. The report is re-evaluated so the ladder reflects the new state.
- **Alternative flows:** A non-field role calls the authenticated route → `403` from `require_roles`.
- **Expected result:** Status and provenance are visible; `not_confirmed` reports stop contributing positive community evidence.

> Requires the community lifecycle migration to be applied (see [`../technical/DATABASE.md`](../technical/DATABASE.md)).

---

## UC-04 — Village Authority corroborates a report

- **Actor:** Village Authority
- **Preconditions:** A report exists for the actor's village.
- **Main flow:**
  1. The VA reviews the report and any field confirmations.
  2. They post to `POST /api/community/reports/{id}/corroborate`.
  3. The backend checks the actor's `village_id` matches the report's village and sets `verification_status = corroborated`.
- **Alternative flows:** A VA for a different village → `403`. Missing `village_id` on the profile → rejected.
- **Expected result:** Local governance confirmation is recorded independently.


---

## UC-05 — Control Room reviews evidence and recommends an alert

- **Actor:** Control Room operator
- **Preconditions:** Evidence exists; a score ≥ 70 produced a `pending_approval` alert.
- **Main flow:**
  1. The operator inspects Command View (score, factors, reasons) and Inbound Data (sources).
  2. They mark a report verified/rejected or request clarification via `POST /api/community/reports/{id}/review`.
  3. They open the alert review package.
- **Alternative flows:** Score < 70 → no alert is created; the operator continues monitoring.
- **Expected result:** A recommendation with full provenance is ready for the Disaster Authority. The Control Room cannot approve the official alert.

---

## UC-06 — Disaster Authority approves the official alert

- **Actor:** Disaster Authority
- **Preconditions:** A `pending_approval` alert exists with a populated event.
- **Main flow:**
  1. The official reviews hazard, impact, villages, ETA and the Control Room recommendation.
  2. They choose Approve or Reject.
  3. The SPA posts to `POST /api/alerts/{id}/approve` (or `/api/alerts/demo/{id}/approve`).
  4. The backend verifies the role (`disaster_authority` / `admin`), writes an `alert_approvals` audit row, and transitions the alert.
- **Alternative flows:** Reject → the alert is cancelled with the reason recorded; Control Room attempting approval → `403`.
- **Expected result:** An audited authorization decision. Public dispatch remains a later phase.

---

## UC-07 — Community Member acknowledges the warning

- **Actor:** Community Member
- **Preconditions:** An active alert targets the member's village.
- **Main flow:**
  1. The member views "My Warning".
  2. They press Acknowledge.
  3. The SPA posts to `POST /api/community-member/demo/acknowledge`.
  4. The backend resolves the village's latest `alert_target.alert_id` and stamps `alert_deliveries.acknowledged_at`.
- **Alternative flows:** No alert exists → `400` with an explanatory message (nothing to acknowledge).
- **Expected result:** Acknowledgement is persisted, not just local UI state.

---

## UC-08 — Sensor ingestion contributes confirmation

- **Actor:** Sensor gateway / operator using Inbound Data
- **Preconditions:** A device exists in `sensor_devices`; the caller supplies the ingest key.
- **Main flow:**
  1. A reading is posted to `POST /api/sensors/readings` with the `x-sensor-key` header.
  2. The backend stores it in `sensor_readings` and re-evaluates the station.
  3. The next evaluation's `get_station_evidence` finds it and awards sensor points.
- **Alternative flows:** Missing/invalid key → `401`/`403`.
- **Expected result:** A `water_level` sensor at or above the station warning level adds up to 10 points.

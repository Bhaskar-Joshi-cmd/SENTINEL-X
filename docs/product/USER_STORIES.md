# User Stories

Only behaviour that exists in the code today, or is explicitly marked planned in [`PRD.md`](./PRD.md), is listed here.

## Control Room / DEOC

**As a** Control Room operator,
**I want to** see the current station reading, the 0–100 rule-engine score with its five factors, and the risk band,
**so that** I can understand why the system reached its current state.

**As a** Control Room operator,
**I want to** see hydro, sensor and community evidence together in Inbound Data,
**so that** I can corroborate a hazard from independent sources before recommending an alert.

**As a** Control Room operator,
**I want to** mark a community report as verified, rejected, or request clarification,
**so that** the report's credibility is recorded separately from the alert decision.

**As a** Control Room operator,
**I want to** see which villages received a warning and its delivery state,
**so that** I can tell whether the last mile was actually reached.

**As a** Control Room operator,
**I want** the dashboard to advance a new observation automatically every 10 seconds,
**so that** the display behaves like a live feed for demonstration purposes.

## Disaster Authority

**As a** Disaster Authority official,
**I want to** review the hazard score, village impact, time-to-impact and the Control Room's recommendation,
**so that** I can make an informed authorization decision.

**As a** Disaster Authority official,
**I want to** approve or reject the official alert,
**so that** only an authorized decision produces a public warning.

## Village Authority

**As a** Village Authority representative,
**I want to** see reports and field confirmations for my village,
**so that** I can corroborate the local situation.

**As a** Village Authority representative,
**I want to** corroborate a report for my own village,
**so that** local governance confirmation is recorded independently of the Control Room.

**As a** Village Authority representative,
**I want to** submit a local report and acknowledge the local warning,
**so that** my village's picture is complete.

## Community Manager

**As a** Community Manager (trained local field POC),
**I want to** see village reports awaiting field action,
**so that** I can physically check the most important ones first.

**As a** Community Manager,
**I want to** confirm or dispute a report from the field and add comments,
**so that** the system reflects what I actually observed on the ground.

## Community Member

**As a** Community Member,
**I want to** submit a hazard report with type and severity,
**so that** the Control Room knows what is happening in my area.

**As a** Community Member,
**I want to** see the current warning and acknowledge that I received it,
**so that** responders know the warning reached me.

## System Admin

**As a** System Admin,
**I want to** see service health, data inventory and role-directory counts,
**so that** I can confirm the platform is operating.

## Cross-cutting (planned, not yet implemented)

**As a** village that has lost connectivity,
**I want** the warning to reach me through an offline relay,
**so that** network failure does not suppress the warning. *(Planned — relay triggering is a marked hook in `replay_service.py`.)*

**As a** Disaster Authority official,
**I want** my authorization to require a verified identity,
**so that** alerts cannot be approved by an anonymous user. *(Planned — the backend dependency exists, the SPA login does not.)*

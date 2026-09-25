# Vision — SENTINEL-X / CascadeGuard

## Purpose

SENTINEL-X exists for one reason: **the warning should survive the failure that makes it necessary.** In Himalayan valleys, connectivity is the first thing to go during a flood. Most warning systems assume a working network at exactly the moment the network stops working.

## What we are trying to achieve

A coordinated, explainable flood-warning loop for the villages below a monitored river gauge:

1. **Sense** — river level and rate, plus field sensors and human reports from the valley floor.
2. **Fuse** — one deterministic 0–100 score that shows its work.
3. **Project** — which villages are exposed, how soon, and how many people.
4. **Authorize** — a human decision by the responsible district authority.
5. **Deliver** — through whatever channel survives: internet, cellular, or an offline relay.

The last-mile problem is the point, not a side feature. A warning that cannot be delivered during the outage is a warning that does not exist.

## Core principles

- **Human-in-the-loop.** The system recommends; an authorized Disaster Authority decides. Community reports never auto-trigger an official alert.
- **Explainable over clever.** A transparent weighted score that an operator can read beats an opaque model.
- **Graceful degradation.** Loss of connectivity must reduce the channel, not the capability.
- **Evidence before authority.** A report is evidence. Verification is credibility. Only the district authority authorizes an alert. These stay separate.
- **Design for the disconnected village, not the connected office.** Offline relay and asynchronous acknowledgement are first-class.
- **No invented confidence.** Missing evidence scores zero; it is never silently replaced by a flattering default.
- **Configuration over assumption.** Who counts as the Village Authority or Community Manager is set per deployment, not hardcoded to one administrative arrangement.

## Intended users

See the persona table in [`PRD.md`](./PRD.md). In short: an operational Control Room that monitors and verifies, an authorized district Disaster Authority that decides, a Village Authority that corroborates locally, a Community Manager who is physically present in the village, and Community Members who report what they see.

## Long-term direction

1. Replace the historical replay stream with live CWC and relay ingestion.
2. Wire real Supabase Auth so role and village assignment are enforced from the identity provider, not a demo selector.
3. Close the approval loop: authorized approval → target selection → real dissemination and delivery acknowledgement.
4. Trigger per-village messaging/relay automatically from impact rows on each evaluation cycle.
5. Extend from two basins to a river-network model with terrain-aware propagation.

## What we are not trying to build

A general-purpose emergency platform, a public social network, or a black-box predictive model. The scope is a defensible flood-warning chain for a small number of basins.

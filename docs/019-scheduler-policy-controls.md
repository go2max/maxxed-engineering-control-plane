# PR 019 — Scheduler policy controls

Adds the remaining bounded scheduling-policy layer without creating a second execution authority.

Implemented:
- deadline/SLA urgency weighting;
- bounded, reason-required, optionally expiring priority overrides;
- repository freeze/thaw controls;
- repository drain/resume controls;
- explicit scheduler backpressure reasons for frozen/draining repositories;
- rebalancing recommendations for stranded free capacity, repository concentration and full saturation.

Operator policy adjusts dispatch eligibility and score only. It does not rewrite task truth, claims, dependency state or acceptance evidence.

Portfolio Scheduler and Dynamic Lanes advances from 70% to 86%.

# PR 020 — Bounded operator policy API

Extends the authenticated control-plane service so scheduler policy is operational rather than library-only.

Implemented semantic commands:
- pause/resume dispatch;
- set repository lane limit (0..64);
- freeze/thaw repository;
- drain/resume repository;
- set/clear bounded reason-required priority override;
- recover expired claims.

No arbitrary shell or free-form execution endpoint exists. Scheduler policy state, pause state and repository lane overrides persist across runtime restart. Existing compatibility pause/resume/recovery routes map into the same bounded command surface.

Category movement:
- Engineering Control Plane Core: 82% → 90%
- Portfolio Scheduler and Dynamic Lanes: 86% → 94%

# PR 014 — Local model evals and fallback

Adds deterministic model-manifest digests plus per-task-class evaluation history for acceptance rate, latency and failure attribution. Models with enough evidence and poor acceptance rates are automatically excluded from routing.

Eligible local models are ranked by observed acceptance rate, then latency, before static priority/cost/context tie-breakers. The router exposes an ordered local fallback list; external escalation remains disabled by default.

Local AI / Model Router advances from 32% to 50%.

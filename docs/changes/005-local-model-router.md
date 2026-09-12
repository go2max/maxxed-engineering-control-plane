# PR 005 — Local model router

Adds the executable local-first model selection boundary: model registry, health state, capability/context/cost eligibility, deterministic routing, and an OpenAI-compatible local inference client suitable for a locally hosted inference server.

External models are excluded unless escalation is explicitly enabled. The default path therefore remains self-contained and zero-cost at inference routing time.

This slice advances Local AI / Model Router from 6% to 28%.

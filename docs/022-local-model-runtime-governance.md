# PR 022 — Local model runtime governance

Adds runtime admission and failover controls for self-contained local inference.

Implemented:
- optional model artifact SHA-256 integrity gate;
- local model health warmup probes;
- per-model concurrency budgets;
- failure-count circuit breakers with cooldown;
- admission refusal for integrity failures, open circuits or exhausted concurrency;
- deterministic local-to-local execution fallback using the existing router order;
- external escalation remains disabled.

Local AI / Model Router advances from 50% to 70%.

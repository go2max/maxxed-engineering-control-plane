# Local model training/evaluation corpus

This directory contains provenance-tagged examples derived from validated Maxxed engineering-platform behavior.

Principles:
- No secrets, tokens, credentials, personal data, or raw private-repository source are included.
- Training and held-out evaluation data are kept separate.
- Every record names its task class, source category, provenance, and expected behavior.
- Records describe deterministic engineering decisions and outcomes; they do not make the model authoritative for leases, fencing, liveness, or other control-plane state.
- Deterministic infrastructure remains authoritative. Models may classify, rank, summarize, propose, or explain, but the control plane validates and executes.

Seed files:
- `train/seed-v1.jsonl` — supervised examples for routing, diagnosis, planning, repair, and operator summarization.
- `eval/seed-v1.jsonl` — held-out cases used only for evaluation.
- `manifest.json` — schema/version/provenance and contamination controls.

Do not train on the eval file. New data should be appended through a versioned PR and include provenance plus a reviewable task class.
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
- `manifest.json` — schema/version/provenance, domains, and contamination controls.

Do not train on the eval file. New data should be appended through a versioned PR and include provenance plus a reviewable task class.

## Canonical training system

This repository is the canonical owner of model training data and process going forward. Other
Maxxed systems (e.g. email-marketing's own `llm_control.training_examples` table and
`lib/training-system/`) may be imported here as a *source*, but do not remain the architectural
owner of training data once imported — see `docs/training/EVALUATION_PROMOTION_PORT_DESIGN.md`
for the plan to bring the evaluation/promotion/shadow-run mechanism here as well.

## Domains

Training data is organized into seven domains that must stay separated and not be mixed into one
corpus (see `manifest.json`'s `domains` list):

- `coding`
- `repository-understanding`
- `infrastructure-diagnosis`
- `business-reasoning`
- `outreach-support`
- `orchestration-agent-planning`
- `security-reliability`

Each entry in `manifest.json`'s `datasets` array declares exactly one domain and points at its own
`train`/`eval` JSONL files. `scripts/validate-training-data.mjs` enforces: every record's optional
`domain` field (if present) matches its dataset's declared domain, no id collides across datasets,
and no eval record's id or `(instruction, input)` fingerprint duplicates anything in its own
dataset's train split.

## Importing from another system

`scripts/import-training-examples-email-marketing.mjs` is a read-only importer that pulls rows
from email-marketing's `llm_control.training_examples` table (via its own `DATABASE_URL`/`pg`
connection — never written to) and writes them into this repo's domain-tagged JSONL format with
full provenance (`source_system`, `source_table`, `source_record_id`, `imported_at`,
`import_dataset_version`). Each import run also writes a summary manifest under
`training/import-runs/` with counts and content hashes. See the script's header comment for usage.

Import caveat carried over from email-marketing's own
`docs/training/CANONICAL_TRAINING_VERIFICATION_REPORT.md`: legacy `good`/`bad`/`corrected` labels
are transport-accepted only, not evidence of output quality. Imported records are tagged
`legacy-transport-accepted-label` and must not be treated as promotion-eligible gold/silver/bronze
data until they pass this repo's own eligibility/evaluation gates (not yet ported — see the design
doc above).
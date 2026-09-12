# PR 013 — Failure fingerprints and reconciliation

Adds deterministic normalized failure fingerprints that remove volatile IDs, SHAs and path formatting before hashing, plus cross-task duplicate attribution.

Repair planning is now failure-class specific. Test/build failures get bounded repair sequences, infrastructure failures can move to another worker, security/policy failures require review, and uncertain external mutations require authoritative state reconciliation before work resumes.

Verifier and Repair Fabric advances from 42% to 58%.

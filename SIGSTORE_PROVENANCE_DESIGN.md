# Sigstore-Style Build/Release Signing Design

Status: design only — not implemented. Companion to `SECURITY_GOVERNANCE.md` ("Supply-chain provenance") and
`src/security/artifact-attestation.js`.

## Current state (as found)

`src/security/artifact-attestation.js` already implements a Maxxed-native attestation format:
`buildSbom`, `buildArtifactAttestation`, `signArtifactAttestation`, `verifyArtifactAttestation` — an
in-toto-shaped statement (`predicateType`, `subject.sha256`, `sourceSha`, `toolchain`, `sbomDigest`) signed
with a raw Ed25519 keypair via Node's `crypto.sign`/`crypto.verify`. This is real, tested crypto, but it is:
- not real Sigstore (no Fulcio-issued short-lived cert bound to an OIDC identity, no Rekor transparency log
  entry, no keyless signing);
- unwired — only `test/patch-fabric-safety.test.js` calls it (a companion PR in this change set wires it into
  `SaasReleaseLedger.record()`, but that only gates *ledger entries*, not the actual build/publish step);
- keyed by a long-lived private key with no documented custody/rotation story — the single biggest practical
  risk in a hand-rolled signing scheme.

Sigstore's value over the current scheme is exactly the piece missing: identity binding (who/what signed —
tied to a CI workload identity, not a static key file) and public, tamper-evident transparency (Rekor), which
is precisely what makes forged/stale artifacts detectable later, after the pipeline has spread and a hand-rolled
key can leak or go stale silently.

## Target design

**Signing (build time, in CI only — never from a worker or local dev machine):**
1. CI job authenticates to the CI provider's OIDC issuer (GitHub Actions OIDC token is the natural fit given
   this org's use of GitHub).
2. Use `cosign sign-blob` (or `sigstore-js`/`@sigstore/sign` if staying in Node without shelling out) with
   `--identity-token` from the OIDC token above, keyless — Fulcio issues a short-lived cert binding the
   artifact signature to the CI workload identity (repo + workflow + ref), no long-lived private key to
   custody or rotate.
3. The signature and Fulcio cert are logged to the public Rekor transparency log automatically; retain the
   returned Rekor log index/UUID.
4. Continue emitting the existing `buildArtifactAttestation()` in-toto-shaped statement (subject sha256,
   sourceSha, sbomDigest, toolchain) as the *predicate* — wrap it as a real in-toto attestation and sign that
   with cosign's `attest-blob` (or `attest` for OCI artifacts, if artifacts move to a registry), rather than
   the current raw-Ed25519 `signArtifactAttestation()`. Keep `buildSbom`/`buildArtifactAttestation` as-is
   (they're format-correct); replace only the signing step.

**Verification (deploy time, before any release ledger entry or production rollout):**
1. `cosign verify-blob` (or `@sigstore/verify`) checking: signature validity, Fulcio cert chain to the
   Sigstore public-good root (or a self-hosted Sigstore instance if the org later needs private
   transparency), and — critically — that the cert's identity matches an *allowlisted* workflow
   (`repo:go2max/maxxed-engineering-control-plane:ref:refs/heads/main` or equivalent), not just "signed by
   anything Sigstore trusts." Skipping the identity-allowlist check is the most common way teams implement
   Sigstore and still accept an artifact signed by an unrelated but valid CI identity.
2. Only after verification succeeds does the release pipeline call `SaasReleaseLedger.record({..., attestation})`
   (already wired per the companion code PR) — the ledger's existing `attestation.signature` presence check
   stays as defense-in-depth, but the real trust decision moves to the cosign/Rekor verification step above,
   run by the deploy pipeline, not by the ledger.
3. Rekor inclusion proof is checked as part of verification (not just "a signature exists") — this is what
   defends against a compromised-but-still-valid signing identity being used after the fact; an entry with no
   corresponding Rekor log entry (or one outside the expected time window) fails closed.

**Fail-closed rule (consistent with `SECURITY_GOVERNANCE.md` "Fail-closed rules"):** any release path where
identity/cert-chain verification, Rekor inclusion, or workload-identity allowlist match cannot be proven is
rejected, not downgraded to a warning.

## Why design-now / defer-implementation

Sigstore integration is comparatively cheap while there is exactly one artifact pipeline
(`SaasReleaseLedger` + `artifact-attestation.js`) and it is not yet load-bearing in production. Once more
pipelines/repos start emitting and consuming attestations independently, retrofitting a consistent
identity-bound signing scheme across all of them gets materially harder — this doc exists so the *shape* of
the eventual integration is settled now, even though implementation (adding `cosign`/`@sigstore/*` as a real
dependency, wiring CI OIDC, choosing self-hosted vs. public-good Sigstore) is a separate, reviewed piece of
work, not bundled into this design pass.

## Explicitly out of scope here

- Firecracker/gVisor or any workload-execution sandboxing — deferred until third-party/untrusted compute is
  admitted, per current operator scope. Sigstore is about *what ships*, not *where it runs*; it does not
  require or imply relaxing that boundary.
- Migrating existing signed artifacts retroactively — this design applies going forward once implemented.
- Self-hosting a private Sigstore instance (Fulcio/Rekor) — start with the public-good instance; revisit only
  if a compliance requirement forces private transparency.

## Sequencing

1. Add `cosign` (or `@sigstore/sign` + `@sigstore/verify`) to the release CI job; keyless-sign build artifacts,
   capture Rekor UUID alongside the existing `buildArtifactAttestation()` output.
2. Add verification step to the deploy pipeline with the identity allowlist check; wire its pass/fail into the
   same call site that now calls `SaasReleaseLedger.record({..., attestation})`.
3. Decommission `signArtifactAttestation`/`verifyArtifactAttestation`'s raw-Ed25519 path once cosign-based
   signing is live end-to-end, or keep it as a secondary/offline verification path if there's value in not
   depending solely on network access to Rekor — a decision to make at implementation time, not now.

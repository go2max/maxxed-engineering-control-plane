# Secrets Isolation and Encryption Design

Status: design only — not implemented. Companion to `SECURITY_GOVERNANCE.md` ("Secrets and sensitive data") and
the compute-network threat model (`maxxed-tech-site/docs/COMPUTE_NETWORK_CONTROL_PLANE.md`, "Still required
after pilot foundation": field-level PII encryption with key rotation).

Scope note: this covers secrets/encryption for the *current* trusted-operator compute fleet. Heavyweight
participant isolation (Firecracker/gVisor) for third-party/untrusted compute is explicitly out of scope until
outside machines are admitted to execute arbitrary workloads — that becomes a hard gate at that time, not now.

## Current state (as found)

- No vault/secrets-manager abstraction exists in `maxxed-engineering-control-plane` or
  `maxxed-local-compute-fabric` (`vault`, `secretsManager`, `getSecret` — zero hits in either repo).
- `maxxed-tech-site`'s relay credential is the one place secrets are handled well today: injected
  server-side by a Cloudflare Worker, never shipped to client assets, gated by a short-lived scan session
  token (`docs/compute-network/SCAN_FIRST_ADMISSION.md`). This pattern generalizes.
- `maxxed-local-compute-fabric/src/controller/http-server.js` uses plain `http.createServer` — no TLS in
  application code. If a TLS-terminating proxy/tunnel sits in front of it today, that is undocumented and
  unverified; treat controller traffic as unencrypted until confirmed otherwise.
- No AES/KMS/field-level-encryption code exists anywhere in the four repos.
- Machine-credential rotation is real and good (`maxxed-tech-site/platform/src/machine-inventory.js`
  `rotateMachineCredential()` / `revokeMachineCredential()`). Nothing else rotates.

## 1. Secrets isolation

**Principle:** no secret material lives in application source, config committed to git, plaintext files on
worker disks, or in-memory longer than the operation that needs it.

**Design:**
- Introduce a single `SecretsClient` interface in `maxxed-shared-sdk` (new package, e.g.
  `platform/secrets-client/`) with `get(name) -> {value, version}`, `list(prefix)`, and no `set`/`delete` from
  worker-facing code paths (writes are an operator/CI-only path).
- Backing store: a managed secrets manager reachable only from the control plane and CI (not from
  worker/enrollment-facing surfaces) — e.g. Cloudflare Workers Secrets for `maxxed-tech-site` (already in use
  for the relay credential) and a KMS-backed store (AWS Secrets Manager, GCP Secret Manager, or self-hosted
  Vault) for `maxxed-engineering-control-plane` / `maxxed-local-compute-fabric`, chosen based on where those
  services already deploy — do not introduce a new cloud dependency solely for this.
- Every consumer requests secrets by logical name at call time; nothing is cached to disk. In-memory TTL cache
  (seconds, not minutes) is acceptable for high-QPS paths.
- Secret access itself is an audited event: every `SecretsClient.get()` call emits an entry via the existing
  `maxxed-shared-sdk/platform/audit-log/src/auditLog.js` (actor, secret name, NOT the value, timestamp,
  requesting service).
- CI/build secrets (GitHub tokens, model API keys, npm/registry tokens) move out of repository/CI-provider
  plaintext config and into the same `SecretsClient`, injected as short-lived env vars per job, never persisted
  to build artifacts or logs (extend `secret-scanning` gates already referenced in
  `src/security/secret-scanner.js` to run over CI logs, not just patch content).

## 2. Encryption in transit

**Design:**
- `maxxed-local-compute-fabric/src/controller/http-server.js`: terminate TLS at the controller itself
  (Node's `https.createServer` with a cert from the same rotation mechanism as machine credentials) *or*
  explicitly document and verify an upstream TLS-terminating proxy/tunnel (e.g. Cloudflare Tunnel, which the
  `maxxed-tech-site` side already uses for the Worker relay). Pick one and make it provable — a controller
  reachable over plain HTTP is a silent regression risk. Either path must reject plaintext connections once
  live (no opportunistic upgrade / no mixed accept).
- All worker enrollment and signed-request traffic (`signed-enrollment.js`, `WORKER_REQUEST_AUTH_TOP25.md`
  scheme) must ride over the TLS channel above; the Ed25519 request signature is authentication/integrity, not
  a substitute for transport confidentiality.
- Internal service-to-service calls between `maxxed-engineering-control-plane` and
  `maxxed-local-compute-fabric` get the same treatment; do not assume "internal network" implies trusted.

## 3. Encryption at rest

**Design:**
- Field-level encryption for recoverable participant PII (the explicit gap already named in
  `COMPUTE_NETWORK_CONTROL_PLANE.md`): encrypt PII fields (contact info, physical identifiers) before they hit
  D1/storage in `maxxed-tech-site/platform/src/machine-inventory.js`, using an envelope-encryption pattern —
  a per-record data key wrapped by a key-encryption key (KEK) held in the same secrets/KMS backend as §1.
  Non-PII operational fields (machine id, fencing generation, lease state) stay plaintext for queryability.
- Key rotation: rotating the KEK re-wraps data keys without re-encrypting every record (standard envelope
  rotation); rotating a data key requires a re-encrypt pass, run as a bounded background job with progress
  checkpointing (consistent with the "Performance/reliability" resumability requirement).
- Audit logs (`auditLog.js`) and the event journal (`src/core/event-journal.js`) are append-only and
  hash-chained already; they do not need field-level encryption for integrity, but any PII they capture should
  go through the same redaction path `machine-inventory.js` already uses (`redactMachineForAdmin`) before
  being written, not after.

## 4. Credential rotation (extending existing coverage)

Machine credentials already rotate (`machine-inventory.js`). Extend the same discipline to:
- The Worker relay credential (`SCAN_FIRST_ADMISSION.md`) — currently no rotation workflow documented.
- CI/build secrets under the new `SecretsClient` — rotation is a property of the backing secrets manager
  (supported natively by all three candidate backends); wire a scheduled rotation job per
  `WORKER_REQUEST_AUTH_TOP25.md`'s "rotation and migration are explicit" principle, reusing its
  overlap-window pattern (old + new credential both valid during a bounded cutover) rather than inventing a
  new one.

## Sequencing / rollout

1. `SecretsClient` in `maxxed-shared-sdk` + audit wiring (foundational, unblocks everything else).
2. TLS decision + enforcement on the controller (`http-server.js`) — small, high-value, low-risk.
3. Move CI/build secrets onto `SecretsClient`; add rotation job for the Worker relay credential.
4. Field-level PII encryption + KEK rotation in `machine-inventory.js` — largest effort, do last since it
   touches live data migration.

Each step should land as its own PR with its own test coverage; do not bundle.

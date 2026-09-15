// Proof-Carrying Shards, Evidence Graph, and validation-certificate reuse (issue #69).
//
// Builds on `src/verification/evidence-bundle.js` (the existing acceptance-evidence authority):
// a ProofCertificate is a signed-shape envelope around a `buildEvidenceBundle()` payload plus the
// identity dimensions required for safe reuse. It never bypasses evidence-bundle digesting; it
// adds exact-identity matching, a reuse cache, tamper detection and an evidence graph on top.
import { createHash } from 'node:crypto';
import { signCertificatePayload, verifyCertificatePayload } from '../security/certificate-signing-key.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digestOf(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

const SHA40 = /^[0-9a-f]{40}$/i;

/**
 * The exact-identity fingerprint a certificate is bound to. Reuse requires every dimension to
 * match byte-for-byte; any mismatch forces revalidation (issue requirement).
 */
export function certificateFingerprint({
  sourceSha, mutationDigest, environmentFingerprint, policyVersion, executorId, verifierId, acceptanceContractDigest,
  checks = null, accepted = null, composability = null, hasExternalEvidence = null, evidenceBundleDigest = null
} = {}) {
  if (!SHA40.test(String(sourceSha ?? ''))) throw new Error('certificateFingerprint requires a 40-char sourceSha');
  if (!mutationDigest) throw new Error('mutationDigest is required');
  if (!environmentFingerprint) throw new Error('environmentFingerprint is required');
  if (!policyVersion) throw new Error('policyVersion is required');
  if (!executorId) throw new Error('executorId is required');
  if (!verifierId) throw new Error('verifierId is required');
  if (!acceptanceContractDigest) throw new Error('acceptanceContractDigest is required');
  const dims = {
    sourceSha: String(sourceSha).toLowerCase(),
    mutationDigest,
    environmentFingerprint,
    policyVersion: String(policyVersion),
    executorId,
    verifierId,
    acceptanceContractDigest
  };
  // `fingerprint` stays the pure *identity* address: it is the reuse key callers look a candidate
  // shard up by, before any certificate for it exists, so it can only cover identity dimensions.
  //
  // Security review finding 2: identity alone does not pin down what a certificate *says*, so two
  // certificates with the same identity but different `checks`/`accepted` used to be
  // indistinguishable and the second silently overwrote the first in CertificateCache.
  // `contentFingerprint` additionally covers every field that changes the certificate's meaning, so
  // a relabelled certificate (selfReported flipped, accepted forced true, checks rewritten) has a
  // different content fingerprint, and CertificateCache.put refuses to replace a stored
  // certificate whose content fingerprint differs (see below) instead of silently overwriting it.
  const content = { ...dims, checks: checks ?? null, accepted: accepted ?? null, composability: composability ?? null, hasExternalEvidence: hasExternalEvidence ?? null, evidenceBundleDigest: evidenceBundleDigest ?? null };
  return { ...dims, fingerprint: digestOf(dims), contentFingerprint: digestOf(content) };
}

/** The content fingerprint of an already-built certificate (identity + everything it asserts). */
export function certificateContentFingerprint(certificate) {
  return certificateFingerprint({ ...certificate }).contentFingerprint;
}

// Checks whose result is intrinsic to the shard's own diff (composable: safe to reuse verbatim
// on an unchanged shard) vs checks that only make sense against a specific integration/composition
// (non-composable: must never be reused as proof for a different composition).
export const EvidenceComposability = Object.freeze({ COMPOSABLE: 'composable', INTEGRATION_ONLY: 'integration-only' });

const CHECK_CATEGORIES = ['structural', 'tests', 'security', 'economic', 'dependencyImpact'];

/**
 * Builds a Proof-Carrying Shard certificate. Requires an already-produced, externally verified
 * evidence bundle (see evidence-bundle.js) plus source/environment/policy/executor/verifier
 * identity and the categorized checks. Refuses to certify unverified/self-reported claims: every
 * check must carry a `verifiedBy` distinct from the executor, or be explicitly marked
 * `selfReported: true` — and self-reported checks can never by themselves satisfy acceptance.
 */
export function issueProofCertificate({
  evidenceBundle,
  sourceSha,
  mutationDigest,
  environmentFingerprint,
  policyVersion,
  executorId,
  verifierId,
  acceptanceContractDigest,
  checks = {},
  rollback = null,
  artifactHashes = {},
  composability = EvidenceComposability.COMPOSABLE,
  now = Date.now()
} = {}) {
  if (!evidenceBundle?.digest) throw new Error('a built evidence bundle is required');
  if (!Object.values(EvidenceComposability).includes(composability)) throw new Error(`unsupported composability: ${composability}`);

  const normalizedChecks = {};
  for (const category of CHECK_CATEGORIES) {
    const rows = Array.isArray(checks[category]) ? checks[category] : [];
    normalizedChecks[category] = rows.map((row) => {
      const selfReported = row.selfReported === true;
      if (!selfReported && (!row.verifiedBy || row.verifiedBy === executorId)) {
        throw new Error(`check "${row.name ?? category}" must be independently verified or explicitly selfReported`);
      }
      return { name: row.name ?? category, passed: Boolean(row.passed), verifiedBy: row.verifiedBy ?? null, selfReported, detail: row.detail ?? null };
    });
  }
  // Unverified self-reported-only evidence can never mark the certificate accepted.
  const allChecks = Object.values(normalizedChecks).flat();
  const hasExternalEvidence = allChecks.some((check) => !check.selfReported);
  const allPassed = allChecks.every((check) => check.passed);
  const accepted = allPassed && hasExternalEvidence;

  const identity = certificateFingerprint({
    sourceSha, mutationDigest, environmentFingerprint, policyVersion, executorId, verifierId, acceptanceContractDigest,
    checks: normalizedChecks, accepted, composability, hasExternalEvidence, evidenceBundleDigest: evidenceBundle.digest
  });

  const certificate = {
    schema: 'maxxed.proof.certificate.v1',
    fingerprint: identity.fingerprint,
    contentFingerprint: identity.contentFingerprint,
    sourceSha: identity.sourceSha,
    mutationDigest,
    environmentFingerprint,
    policyVersion: identity.policyVersion,
    executorId,
    verifierId,
    acceptanceContractDigest,
    composability,
    checks: normalizedChecks,
    rollback: rollback ? structuredClone(rollback) : null,
    artifactHashes: structuredClone(artifactHashes),
    accepted,
    hasExternalEvidence,
    evidenceBundleDigest: evidenceBundle.digest,
    issuedAt: now
  };
  // Signed seal (security review finding 3): an HMAC-SHA256 over the whole certificate body under
  // the control plane's signing key. The previous unkeyed digest was only a corruption checksum —
  // an attacker could flip `selfReported`/`verifiedBy`/`accepted` and simply recompute it. An HMAC
  // cannot be recomputed without the key, which never leaves the process.
  const seal = signCertificatePayload({ ...certificate });
  return { ...certificate, seal };
}

/**
 * Verifies the certificate's signed seal over its current body (timing-safe). False means the body
 * was mutated after issuance, the certificate was never issued by this control plane, or it was
 * issued under a different (e.g. previous-process) signing key. Also re-derives the content
 * fingerprint, so a certificate whose stored fingerprints disagree with its own content is refused.
 */
export function verifyCertificateIntegrity(certificate) {
  if (!certificate || typeof certificate !== 'object') return false;
  const { seal, ...body } = certificate;
  if (!seal) return false;
  if (!verifyCertificatePayload(body, seal)) return false;
  try {
    const recomputed = certificateFingerprint({ ...certificate });
    return recomputed.fingerprint === certificate.fingerprint && recomputed.contentFingerprint === certificate.contentFingerprint;
  } catch {
    return false;
  }
}

/**
 * Certificate cache keyed by exact fingerprint. `get()` returns a certificate only when its seal
 * still verifies (fail-closed on tamper) and it has not been explicitly invalidated.
 */
export class CertificateCache {
  constructor() { this.byFingerprint = new Map(); this.invalidated = new Set(); this.conflicted = new Set(); }

  put(certificate) {
    if (!verifyCertificateIntegrity(certificate)) throw new Error('refusing to cache a certificate that fails integrity verification');
    // Finding 2, defence in depth: two certificates sharing an identity fingerprint but asserting
    // different things (different checks/accepted/composability/evidence bundle) are contradictory
    // evidence for the same shard. Rather than let the later one silently overwrite the earlier,
    // fail closed: invalidate the fingerprint so neither is reusable until real revalidation runs.
    const existing = this.byFingerprint.get(certificate.fingerprint);
    if (this.conflicted.has(certificate.fingerprint) || (existing && existing.contentFingerprint !== certificate.contentFingerprint)) {
      this.conflicted.add(certificate.fingerprint);
      this.invalidate(certificate.fingerprint, 'conflicting-certificate-content-for-identity');
      throw new Error('refusing to overwrite a cached certificate with conflicting content for the same identity');
    }
    this.byFingerprint.set(certificate.fingerprint, structuredClone(certificate));
    this.invalidated.delete(certificate.fingerprint);
    return certificate.fingerprint;
  }

  /**
   * Attempts reuse for a target identity. Returns { reused: true, certificate } only on an exact
   * fingerprint match against a non-invalidated, integrity-verified, accepted, composable
   * certificate; otherwise { reused: false, reason }.
   */
  tryReuse(targetIdentity, { requireComposable = true } = {}) {
    const fingerprint = targetIdentity?.fingerprint ?? certificateFingerprint(targetIdentity).fingerprint;
    if (this.invalidated.has(fingerprint)) return { reused: false, reason: 'invalidated' };
    const certificate = this.byFingerprint.get(fingerprint);
    if (!certificate) return { reused: false, reason: 'no-exact-match' };
    if (!verifyCertificateIntegrity(certificate)) { this.invalidate(fingerprint, 'tamper-detected-on-read'); return { reused: false, reason: 'tamper-detected' }; }
    if (!certificate.accepted) return { reused: false, reason: 'certificate-not-accepted' };
    if (requireComposable && certificate.composability !== EvidenceComposability.COMPOSABLE) {
      return { reused: false, reason: 'integration-only-evidence-not-reusable-as-shard-proof' };
    }
    return { reused: true, certificate: structuredClone(certificate) };
  }

  /** Narrow, fail-closed invalidation of exactly one fingerprint (source/policy/env/acceptance change). */
  invalidate(fingerprint, reason = 'dimension-changed') {
    this.invalidated.add(fingerprint);
    return { fingerprint, reason };
  }

  get(fingerprint) {
    const certificate = this.byFingerprint.get(fingerprint);
    if (!certificate || this.invalidated.has(fingerprint)) return null;
    return verifyCertificateIntegrity(certificate) ? structuredClone(certificate) : null;
  }

  snapshot() {
    return { version: 1, certificates: [...this.byFingerprint.values()].map((certificate) => structuredClone(certificate)), invalidated: [...this.invalidated] };
  }

  static restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported certificate cache snapshot');
    const cache = new CertificateCache();
    for (const certificate of snapshot.certificates ?? []) {
      // Restore verbatim rather than through put(), which would re-verify integrity; a certificate
      // that failed integrity before persisting should never have been snapshotted in the first
      // place, but we still fail closed here rather than silently resurrecting a tampered entry.
      if (!verifyCertificateIntegrity(certificate)) continue;
      cache.byFingerprint.set(certificate.fingerprint, structuredClone(certificate));
    }
    for (const fingerprint of snapshot.invalidated ?? []) cache.invalidated.add(fingerprint);
    return cache;
  }
}

// Evidence Graph node kinds, matching the issue's required lineage:
// intent -> work packet -> shard -> patch -> candidate SHA -> validation evidence -> artifact -> merge -> release -> production verification.
export const EvidenceNodeKind = Object.freeze({
  INTENT: 'intent',
  WORK_PACKET: 'work-packet',
  SHARD: 'shard',
  PATCH: 'patch',
  CANDIDATE_SHA: 'candidate-sha',
  VALIDATION_EVIDENCE: 'validation-evidence',
  ARTIFACT: 'artifact',
  MERGE: 'merge',
  RELEASE: 'release',
  PRODUCTION_VERIFICATION: 'production-verification'
});

const NODE_ORDER = Object.values(EvidenceNodeKind);
const NODE_RANK = new Map(NODE_ORDER.map((kind, index) => [kind, index]));

/**
 * An append-only, independently auditable Evidence Graph. Merge/release authority traverses this
 * graph instead of trusting free-form agent claims: every node other than `intent` must cite at
 * least one edge to a prerequisite node, and a `validation-evidence` node must reference an actual
 * ProofCertificate fingerprint (never a bare text claim).
 */
export class EvidenceGraph {
  constructor() { this.nodes = new Map(); this.edges = []; }

  addNode({ id, kind, data = {}, parents = [] } = {}) {
    if (!id) throw new Error('node id is required');
    if (!NODE_RANK.has(kind)) throw new Error(`unsupported evidence node kind: ${kind}`);
    if (this.nodes.has(id)) throw new Error(`duplicate evidence node id: ${id}`);
    if (kind !== EvidenceNodeKind.INTENT && parents.length === 0) {
      throw new Error(`node "${id}" of kind ${kind} must cite at least one prerequisite parent`);
    }
    if (kind === EvidenceNodeKind.VALIDATION_EVIDENCE) {
      if (!data.certificateFingerprint) throw new Error('validation-evidence node requires a certificateFingerprint (no free-form claims)');
    }
    for (const parentId of parents) {
      if (!this.nodes.has(parentId)) throw new Error(`unknown parent evidence node: ${parentId}`);
    }
    this.nodes.set(id, { id, kind, data: structuredClone(data), parents: [...parents] });
    for (const parentId of parents) this.edges.push({ from: parentId, to: id });
    return this.nodes.get(id);
  }

  /** Full ancestor chain for a node, ordered from the node back to its root intent(s). */
  lineage(id) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`unknown evidence node: ${id}`);
    const chain = [];
    const visited = new Set();
    const walk = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const current = this.nodes.get(nodeId);
      chain.push(current);
      for (const parentId of current.parents) walk(parentId);
    };
    walk(id);
    return chain;
  }

  /**
   * Merge/release readiness check: does `releaseNodeId` trace back through an unbroken chain that
   * includes an accepted, integrity-verified validation-evidence node for every shard/patch
   * ancestor? Returns coverage detail rather than a bare boolean, per the issue's
   * "surface evidence coverage and missing-proof reasons" requirement.
   */
  evidenceCoverage(releaseNodeId, { certificateCache } = {}) {
    const chain = this.lineage(releaseNodeId);
    const shardsAndPatches = chain.filter((node) => node.kind === EvidenceNodeKind.SHARD || node.kind === EvidenceNodeKind.PATCH);
    const validationNodes = chain.filter((node) => node.kind === EvidenceNodeKind.VALIDATION_EVIDENCE);
    const missingProofReasons = [];

    for (const node of shardsAndPatches) {
      // A shard/patch is covered when a validation-evidence node cites it directly, or cites a
      // descendant of it (e.g. the candidate SHA built from that shard's patch) — evidence for the
      // produced artifact is evidence for the work that produced it.
      const covering = validationNodes.find((validation) => validation.parents.some((parentId) => {
        if (parentId === node.id) return true;
        return this.lineage(parentId).some((ancestor) => ancestor.id === node.id);
      }));
      if (!covering) { missingProofReasons.push({ nodeId: node.id, reason: 'no-validation-evidence-node' }); continue; }
      if (certificateCache) {
        const certificate = certificateCache.get(covering.data.certificateFingerprint);
        if (!certificate) missingProofReasons.push({ nodeId: node.id, reason: 'certificate-missing-or-invalidated' });
        else if (!certificate.accepted) missingProofReasons.push({ nodeId: node.id, reason: 'certificate-not-accepted' });
      }
    }

    return {
      releaseNodeId,
      shardCount: shardsAndPatches.length,
      coveredCount: shardsAndPatches.length - missingProofReasons.length,
      coverageRatio: shardsAndPatches.length ? (shardsAndPatches.length - missingProofReasons.length) / shardsAndPatches.length : 1,
      readyForRelease: missingProofReasons.length === 0,
      missingProofReasons
    };
  }

  snapshot() { return { version: 1, nodes: [...this.nodes.values()], edges: structuredClone(this.edges) }; }
  static restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported evidence graph snapshot');
    const graph = new EvidenceGraph();
    // Replay in edge-safe order: nodes were appended so that every parent precedes its children.
    for (const node of snapshot.nodes) {
      graph.nodes.set(node.id, structuredClone(node));
    }
    graph.edges = structuredClone(snapshot.edges);
    return graph;
  }
}

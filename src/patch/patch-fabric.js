import { validatePatchBundle, PatchBundleStore } from './patch-bundle.js';
import { PatchComposer } from './patch-composer.js';
import { digest } from '../leverage/solution-cas.js';

export const PatchSessionState = Object.freeze({
  COLLECTING: 'COLLECTING',
  READY_TO_COMPOSE: 'READY_TO_COMPOSE',
  COMPOSED: 'COMPOSED',
  ACCEPTED: 'ACCEPTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export class PatchFabric {
  constructor({ bundleStore = new PatchBundleStore(), composer = new PatchComposer() } = {}) {
    this.bundleStore = bundleStore;
    this.composer = composer;
    this.sessions = new Map();
  }

  start({ parentTaskKey, repository = null, baseSha, shardKeys = [], verificationTier = 'parent-full', now = Date.now() } = {}) {
    if (!parentTaskKey) throw new Error('parentTaskKey is required');
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha ?? ''))) throw new Error('patch session requires exact baseSha');
    const expectedShardKeys = [...new Set(shardKeys.map(String))].sort();
    if (!expectedShardKeys.length) throw new Error('patch session requires at least one shard');
    const sessionId = digest({ parentTaskKey, repository, baseSha: String(baseSha).toLowerCase(), expectedShardKeys, createdAt: Number(now) });
    if (this.sessions.has(sessionId)) return this.get(sessionId);
    const row = {
      version: 1, sessionId, parentTaskKey: String(parentTaskKey), repository, baseSha: String(baseSha).toLowerCase(),
      expectedShardKeys, bundleDigests: {}, verificationTier, state: PatchSessionState.COLLECTING,
      composition: null, acceptance: null, failures: [], createdAt: Number(now), updatedAt: Number(now)
    };
    this.sessions.set(sessionId, row);
    return this.get(sessionId);
  }

  submit(sessionId, bundle, { expectedGeneration = null, now = Date.now() } = {}) {
    const session = this.#require(sessionId);
    if (![PatchSessionState.COLLECTING, PatchSessionState.READY_TO_COMPOSE].includes(session.state)) throw new Error(`patch session is not accepting shards: ${session.state}`);
    const valid = validatePatchBundle(bundle);
    if (valid.parentTaskKey !== session.parentTaskKey) throw new Error('patch bundle parentTaskKey does not match session');
    if (valid.baseSha !== session.baseSha) throw new Error('patch bundle baseSha does not match session');
    if (!session.expectedShardKeys.includes(valid.shardKey)) throw new Error(`unexpected shard: ${valid.shardKey}`);
    if (expectedGeneration != null && Number(valid.generation) !== Number(expectedGeneration)) throw new Error(`stale shard generation: ${valid.shardKey}`);
    const priorDigest = session.bundleDigests[valid.shardKey];
    if (priorDigest && priorDigest !== valid.bundleDigest) throw new Error(`conflicting duplicate shard result: ${valid.shardKey}`);
    this.bundleStore.put(valid);
    session.bundleDigests[valid.shardKey] = valid.bundleDigest;
    session.updatedAt = Number(now);
    if (session.expectedShardKeys.every((key) => session.bundleDigests[key])) session.state = PatchSessionState.READY_TO_COMPOSE;
    return this.get(sessionId);
  }

  compose(sessionId, { baseFiles = {}, now = Date.now() } = {}) {
    const session = this.#require(sessionId);
    if (session.state !== PatchSessionState.READY_TO_COMPOSE) throw new Error(`patch session is not ready to compose: ${session.state}`);
    const bundles = session.expectedShardKeys.map((key) => this.bundleStore.get(session.bundleDigests[key]));
    try {
      const composition = this.composer.compose({ baseSha: session.baseSha, baseFiles, bundles, parentTaskKey: session.parentTaskKey, now });
      session.composition = composition;
      session.state = PatchSessionState.COMPOSED;
      session.updatedAt = Number(now);
      return structuredClone(composition);
    } catch (error) {
      session.failures.push({ at: Number(now), phase: 'composition', error: error.message, conflicts: structuredClone(error.conflicts ?? []) });
      session.state = PatchSessionState.FAILED;
      session.updatedAt = Number(now);
      throw error;
    }
  }

  recordParentVerification(sessionId, { accepted, acceptedSha = null, evidence = {}, now = Date.now() } = {}) {
    const session = this.#require(sessionId);
    if (session.state !== PatchSessionState.COMPOSED) throw new Error(`parent verification requires COMPOSED session, got ${session.state}`);
    if (accepted && !/^[0-9a-f]{40}$/i.test(String(acceptedSha ?? ''))) throw new Error('accepted parent verification requires exact acceptedSha');
    session.acceptance = { accepted: Boolean(accepted), acceptedSha: accepted ? String(acceptedSha).toLowerCase() : null, evidence: structuredClone(evidence), at: Number(now) };
    session.state = accepted ? PatchSessionState.ACCEPTED : PatchSessionState.FAILED;
    session.updatedAt = Number(now);
    return this.get(sessionId);
  }

  fail(sessionId, { phase = 'shard', error = 'patch session failed', evidence = {}, now = Date.now() } = {}) {
    const session = this.#require(sessionId);
    if ([PatchSessionState.ACCEPTED, PatchSessionState.CANCELLED].includes(session.state)) throw new Error(`terminal patch session cannot fail: ${session.state}`);
    if (session.state === PatchSessionState.FAILED) return this.get(sessionId);
    session.failures.push({ at: Number(now), phase: String(phase), error: String(error), evidence: structuredClone(evidence) });
    session.state = PatchSessionState.FAILED;
    session.updatedAt = Number(now);
    return this.get(sessionId);
  }

  cancel(sessionId, reason = 'cancelled', now = Date.now()) {
    const session = this.#require(sessionId);
    if (session.state === PatchSessionState.ACCEPTED) throw new Error('accepted patch session cannot be cancelled');
    session.state = PatchSessionState.CANCELLED; session.updatedAt = Number(now); session.failures.push({ at: Number(now), phase: 'cancel', error: String(reason) });
    return this.get(sessionId);
  }

  get(sessionId) { const row = this.sessions.get(sessionId); return row ? structuredClone(row) : null; }
  list() { return [...this.sessions.values()].map((row) => structuredClone(row)); }
  snapshot() { return { version: 1, sessions: this.list(), bundleStore: this.bundleStore.snapshot() }; }
  restore(snapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new Error('unsupported patch fabric snapshot');
    this.sessions = new Map((snapshot.sessions ?? []).map((row) => [row.sessionId, structuredClone(row)]));
    this.bundleStore.restore(snapshot.bundleStore);
  }

  #require(sessionId) { const row = this.sessions.get(sessionId); if (!row) throw new Error(`unknown patch session: ${sessionId}`); return row; }
}

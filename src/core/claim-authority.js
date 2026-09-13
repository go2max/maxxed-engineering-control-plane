import { randomUUID } from 'node:crypto';

export class ClaimAuthority {
  #claims = new Map();
  #generation = new Map();

  claim({ taskKey, ownerId, scopes = [], ttlMs = 30_000 }, now = Date.now()) {
    if (this.#claims.has(taskKey)) return null;
    const normalizedScopes = [...new Set(scopes)].sort();
    const conflict = [...this.#claims.values()].find((claim) => claim.scopes.some((scope) => normalizedScopes.includes(scope)));
    if (conflict) return null;
    const generation = (this.#generation.get(taskKey) ?? 0) + 1;
    this.#generation.set(taskKey, generation);
    const claim = { taskKey, ownerId, scopes: normalizedScopes, claimId: randomUUID(), generation, issuedAt: now, expiresAt: now + ttlMs };
    this.#claims.set(taskKey, claim);
    return structuredClone(claim);
  }

  renew(token, ttlMs = 30_000, now = Date.now()) {
    const claim = this.#claims.get(token.taskKey);
    if (!this.#matches(claim, token) || claim.expiresAt <= now) return null;
    claim.expiresAt = now + ttlMs;
    return structuredClone(claim);
  }

  validate(token, now = Date.now()) { const claim = this.#claims.get(token.taskKey); return Boolean(claim && claim.expiresAt > now && this.#matches(claim, token)); }
  release(token) { const claim = this.#claims.get(token.taskKey); if (!this.#matches(claim, token)) return false; this.#claims.delete(token.taskKey); return true; }
  fence(taskKey) { const generation = (this.#generation.get(taskKey) ?? 0) + 1; this.#generation.set(taskKey, generation); this.#claims.delete(taskKey); return generation; }

  sweepExpired(now = Date.now()) {
    const expired = [];
    for (const [taskKey, claim] of this.#claims) {
      if (claim.expiresAt <= now) { this.fence(taskKey); expired.push(structuredClone(claim)); }
    }
    return expired;
  }

  list() { return [...this.#claims.values()].map((claim) => structuredClone(claim)); }

  snapshot() {
    return {
      version: 2,
      generations: [...this.#generation.entries()].map(([taskKey, generation]) => ({ taskKey, generation })),
      claims: this.list()
    };
  }

  restore(snapshot) {
    if (!snapshot || ![1, 2].includes(snapshot.version)) throw new Error('unsupported claim authority snapshot');
    this.#claims.clear();
    this.#generation.clear();
    for (const record of snapshot.generations ?? []) this.#generation.set(record.taskKey, Number(record.generation) || 0);
    if (snapshot.version === 1) return;
    for (const record of snapshot.claims ?? []) {
      if (!record?.taskKey || !record?.ownerId || !record?.claimId) throw new Error('invalid active claim snapshot record');
      const generation = Number(record.generation);
      const issuedAt = Number(record.issuedAt);
      const expiresAt = Number(record.expiresAt);
      if (!Number.isInteger(generation) || generation < 1 || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < issuedAt) {
        throw new Error(`invalid active claim snapshot record: ${record.taskKey}`);
      }
      if (this.#claims.has(record.taskKey)) throw new Error(`duplicate active claim snapshot record: ${record.taskKey}`);
      const claim = {
        taskKey: record.taskKey,
        ownerId: record.ownerId,
        scopes: [...new Set(record.scopes ?? [])].sort(),
        claimId: record.claimId,
        generation,
        issuedAt,
        expiresAt
      };
      this.#claims.set(record.taskKey, claim);
      this.#generation.set(record.taskKey, Math.max(this.#generation.get(record.taskKey) ?? 0, generation));
    }
  }

  #matches(claim, token) { return Boolean(claim && token && claim.taskKey === token.taskKey && claim.ownerId === token.ownerId && claim.claimId === token.claimId && claim.generation === token.generation); }
}

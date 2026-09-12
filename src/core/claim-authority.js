import { randomUUID } from 'node:crypto';

export class ClaimAuthority {
  #claims = new Map();
  #generation = new Map();

  claim({ taskKey, ownerId, scopes = [], ttlMs = 30_000 }, now = Date.now()) {
    this.sweepExpired(now);
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
    return { version: 1, generations: [...this.#generation.entries()].map(([taskKey, generation]) => ({ taskKey, generation })) };
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported claim authority snapshot');
    this.#claims.clear();
    this.#generation.clear();
    for (const record of snapshot.generations ?? []) this.#generation.set(record.taskKey, Number(record.generation) || 0);
  }

  #matches(claim, token) { return Boolean(claim && token && claim.taskKey === token.taskKey && claim.ownerId === token.ownerId && claim.claimId === token.claimId && claim.generation === token.generation); }
}

/**
 * Serializes access to hot symbols/files (frequently touched, high-conflict-rate identifiers)
 * without reverting to whole-repository locking. Any shard that doesn't touch a currently-hot
 * symbol/file proceeds fully in parallel; only shards competing for the same hot identifier are
 * queued against each other.
 */
export class HotSymbolLock {
  constructor({ hotThreshold = 3, hotWindow = 20 } = {}) {
    this.hotThreshold = Math.max(1, Number(hotThreshold));
    this.hotWindow = Math.max(1, Number(hotWindow));
    this.recentTouches = new Map(); // identifier -> array of shardKeys (recency window)
    this.holders = new Map(); // identifier -> shardKey currently holding the lock
  }

  #touch(identifier) {
    const row = this.recentTouches.get(identifier) ?? [];
    return row;
  }

  #isHot(identifier) {
    return this.#touch(identifier).length >= this.hotThreshold;
  }

  /** Identifiers considered hot right now, given the recent-touch window. */
  hotIdentifiers() {
    return [...this.recentTouches.entries()].filter(([, touches]) => touches.length >= this.hotThreshold).map(([identifier]) => identifier);
  }

  /**
   * Which of this shard's declared identifiers (files/symbols) are currently hot and would
   * require serialized access.
   */
  contendedIdentifiers(shard) {
    const identifiers = [...new Set([...(shard.scope?.files ?? []), ...(shard.scope?.symbols ?? [])])];
    return identifiers.filter((identifier) => this.#isHot(identifier));
  }

  /**
   * Attempt to acquire serialized access for every hot identifier this shard touches. Cold
   * identifiers never require acquisition, so unrelated shards never wait on each other or on
   * a repo-wide lock. Returns { acquired: boolean, blockedBy: string[] identifiers already held
   * by another shard }.
   */
  acquire(shardKey, shard) {
    const identifiers = [...new Set([...(shard.scope?.files ?? []), ...(shard.scope?.symbols ?? [])])];
    for (const identifier of identifiers) {
      const touches = this.#touch(identifier);
      touches.push(shardKey);
      this.recentTouches.set(identifier, touches.slice(-this.hotWindow));
    }
    const hot = identifiers.filter((identifier) => this.#isHot(identifier));
    const blockedBy = [];
    for (const identifier of hot) {
      const holder = this.holders.get(identifier);
      if (holder && holder !== shardKey) blockedBy.push(identifier);
    }
    if (blockedBy.length) {
      // Don't partially acquire; release anything held from an earlier attempt for this shard.
      for (const identifier of hot) {
        if (this.holders.get(identifier) === shardKey) this.holders.delete(identifier);
      }
      return { acquired: false, blockedBy, hotIdentifiers: hot };
    }
    for (const identifier of hot) this.holders.set(identifier, shardKey);
    return { acquired: true, blockedBy: [], hotIdentifiers: hot };
  }

  release(shardKey) {
    for (const [identifier, holder] of this.holders.entries()) {
      if (holder === shardKey) this.holders.delete(identifier);
    }
  }

  snapshot() {
    return {
      version: 1,
      recentTouches: [...this.recentTouches.entries()],
      holders: [...this.holders.entries()]
    };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported hot-symbol-lock snapshot');
    this.recentTouches = new Map((snapshot?.recentTouches ?? []).map(([identifier, touches]) => [identifier, [...touches]]));
    this.holders = new Map(snapshot?.holders ?? []);
  }
}

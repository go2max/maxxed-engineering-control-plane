function set(values = []) { return new Set(values); }
function intersect(a, b) { return [...a].filter((value) => b.has(value)); }

/**
 * Detects pairwise and multi-shard *semantic* conflicts that boundary-based scope overlap
 * (conflict-graph.js) cannot see: two shards that touch disjoint files/symbols but change
 * behavior that interacts (shared invariant, same exported contract, same capability, or a
 * declared semantic edge such as caller/callee across a changed signature).
 */
export class SemanticConflictDetector {
  /**
   * @param {object[]} shards - each shard: { key, scope: { files, symbols, resources },
   *   semantics: { capabilities?: string[], contracts?: string[], invariants?: string[],
   *                callsInto?: string[], exports?: string[] } }
   */
  detectPairwise(shards = []) {
    const conflicts = [];
    for (let i = 0; i < shards.length; i += 1) {
      for (let j = i + 1; j < shards.length; j += 1) {
        const verdict = this.#pairwise(shards[i], shards[j]);
        if (verdict.conflict) conflicts.push({ left: shards[i].key, right: shards[j].key, ...verdict });
      }
    }
    return conflicts;
  }

  #pairwise(left, right) {
    const reasons = [];
    const leftSem = left.semantics ?? {};
    const rightSem = right.semantics ?? {};
    const sharedCapabilities = intersect(set(leftSem.capabilities), set(rightSem.capabilities));
    if (sharedCapabilities.length) reasons.push(`shared-capability:${sharedCapabilities.join(',')}`);
    const sharedContracts = intersect(set(leftSem.contracts), set(rightSem.contracts));
    if (sharedContracts.length) reasons.push(`shared-contract:${sharedContracts.join(',')}`);
    const sharedInvariants = intersect(set(leftSem.invariants), set(rightSem.invariants));
    if (sharedInvariants.length) reasons.push(`shared-invariant:${sharedInvariants.join(',')}`);
    // A shard that calls into a symbol the other shard's exports change is a semantic edge even
    // with zero file/symbol overlap in the raw scope.
    const leftCallsRightExports = intersect(set(leftSem.callsInto), set(rightSem.exports));
    if (leftCallsRightExports.length) reasons.push(`caller-callee:${leftCallsRightExports.join(',')}`);
    const rightCallsLeftExports = intersect(set(rightSem.callsInto), set(leftSem.exports));
    if (rightCallsLeftExports.length) reasons.push(`caller-callee:${rightCallsLeftExports.join(',')}`);
    return { conflict: reasons.length > 0, reasons };
  }

  /**
   * Multi-shard conflicts: a capability/contract/invariant touched by three or more shards is
   * flagged even when every pairwise combination looks safe in isolation, since the emergent
   * composition (N-way) risk is what plain pairwise scanning misses.
   */
  detectMultiShard(shards = [], { minParticipants = 3 } = {}) {
    const byDimension = new Map();
    const record = (dimension, name, shardKey) => {
      const dimKey = `${dimension}:${name}`;
      if (!byDimension.has(dimKey)) byDimension.set(dimKey, new Set());
      byDimension.get(dimKey).add(shardKey);
    };
    for (const shard of shards) {
      const sem = shard.semantics ?? {};
      for (const capability of sem.capabilities ?? []) record('capability', capability, shard.key);
      for (const contract of sem.contracts ?? []) record('contract', contract, shard.key);
      for (const invariant of sem.invariants ?? []) record('invariant', invariant, shard.key);
    }
    const threshold = Math.max(2, Number(minParticipants));
    return [...byDimension.entries()]
      .filter(([, participants]) => participants.size >= threshold)
      .map(([dimension, participants]) => ({ dimension, participants: [...participants].sort() }));
  }

  /**
   * Full report: pairwise + multi-shard, and whether composition should be blocked before
   * attempting integration (fail before composing, not after).
   */
  analyze(shards = [], options = {}) {
    const pairwise = this.detectPairwise(shards);
    const multiShard = this.detectMultiShard(shards, options);
    return { pairwise, multiShard, blocksComposition: pairwise.length > 0 || multiShard.length > 0 };
  }
}

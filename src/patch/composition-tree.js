import { digest } from '../leverage/solution-cas.js';

/**
 * Records the decomposition strategy used for each accepted composition (how many shards,
 * their sizes/scopes, projected vs actual savings) and lets counterfactual alternatives be
 * compared against what actually happened, so future planning decisions have real evidence
 * instead of only the plan that was chosen.
 */
export class CompositionTree {
  constructor() {
    this.nodes = new Map(); // compositionDigest -> node
  }

  record({
    parentTaskKey,
    baseSha,
    strategy,
    shards = [],
    projectedMs = null,
    projectedSavingsMs = null,
    actualMs = null,
    outcome = 'pending',
    alternatives = [],
    now = Date.now()
  } = {}) {
    if (!parentTaskKey) throw new Error('parentTaskKey is required');
    const core = { parentTaskKey, baseSha, strategy, shardKeys: shards.map((shard) => shard.shardKey ?? shard.key).sort() };
    const compositionDigest = digest(core);
    const node = {
      compositionDigest,
      parentTaskKey,
      baseSha,
      strategy,
      shardCount: shards.length,
      shardSizes: shards.map((shard) => Number(shard.estimatedLines ?? shard.lines ?? 0)),
      projectedMs, projectedSavingsMs, actualMs,
      outcome,
      alternatives: alternatives.map((alt) => ({
        strategy: alt.strategy,
        shardCount: Number(alt.shardCount ?? 0),
        projectedMs: alt.projectedMs ?? null,
        projectedSavingsMs: alt.projectedSavingsMs ?? null
      })),
      recordedAt: Number(now)
    };
    this.nodes.set(compositionDigest, node);
    return structuredClone(node);
  }

  updateOutcome(compositionDigest, { outcome, actualMs = null } = {}) {
    const node = this.nodes.get(compositionDigest);
    if (!node) throw new Error(`unknown composition: ${compositionDigest}`);
    node.outcome = outcome;
    if (actualMs != null) node.actualMs = Number(actualMs);
    return structuredClone(node);
  }

  get(compositionDigest) {
    const node = this.nodes.get(compositionDigest);
    return node ? structuredClone(node) : null;
  }

  /**
   * Compare the chosen strategy's actual/projected outcome against its recorded alternatives,
   * to see whether a different decomposition would plausibly have performed better.
   */
  compareAlternatives(compositionDigest) {
    const node = this.nodes.get(compositionDigest);
    if (!node) throw new Error(`unknown composition: ${compositionDigest}`);
    const chosenMs = node.actualMs ?? node.projectedMs;
    const ranked = [
      { strategy: node.strategy, shardCount: node.shardCount, ms: chosenMs, chosen: true },
      ...node.alternatives.map((alt) => ({ strategy: alt.strategy, shardCount: alt.shardCount, ms: alt.projectedMs, chosen: false }))
    ].filter((row) => row.ms != null).sort((a, b) => a.ms - b.ms);
    return { compositionDigest, ranked, chosenWasBest: ranked.length ? ranked[0].chosen : null };
  }

  forParent(parentTaskKey) {
    return [...this.nodes.values()].filter((node) => node.parentTaskKey === parentTaskKey).map((node) => structuredClone(node));
  }

  snapshot() {
    return { version: 1, nodes: [...this.nodes.values()].map((node) => structuredClone(node)) };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported composition-tree snapshot');
    this.nodes = new Map((snapshot?.nodes ?? []).map((node) => [node.compositionDigest, structuredClone(node)]));
  }
}

import { digest } from '../leverage/solution-cas.js';
import { AdaptiveShardSizer } from './adaptive-shard-sizing.js';

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

function overlaps(a, b) {
  const files = new Set(a.files ?? []); const symbols = new Set(a.symbols ?? []); const resources = new Set(a.resources ?? []);
  return (b.files ?? []).some((x) => files.has(x)) || (b.symbols ?? []).some((x) => symbols.has(x)) || (b.resources ?? []).some((x) => resources.has(x));
}

export class MicroShardPlanner {
  constructor({ minLines = 40, targetLines = 250, maxLines = 600, fixedShardOverheadMs = 1500, compositionOverheadMs = 1200, adaptiveSizer = new AdaptiveShardSizer({ minLines, baselineTargetLines: targetLines, maxLines }) } = {}) {
    this.minLines = minLines; this.targetLines = targetLines; this.maxLines = maxLines; this.fixedShardOverheadMs = fixedShardOverheadMs; this.compositionOverheadMs = compositionOverheadMs;
    this.adaptiveSizer = adaptiveSizer;
  }

  /**
   * Feed a completed shard's outcome back into the adaptive sizer so future plan() calls for
   * this (executor, task-class) pairing reflect what actually happened in production.
   */
  recordShardOutcome({ executorId, taskClass, shardLines, outcome, verifierCostMs = null, now = Date.now() } = {}) {
    if (!this.adaptiveSizer || !executorId) return null;
    return this.adaptiveSizer.recordOutcome({ executorId, taskClass, shardLines, outcome, verifierCostMs, now });
  }

  plan({ parentTaskKey, baseSha, units = [], availableSlots = 1, verifierSlots = 1, composerSlots = 1, estimatedMonolithicMs = null, maxShards = 64, riskClass = 'normal', executorId = null, taskClass = null, sizingFeatures = {} } = {}) {
    if (!parentTaskKey) throw new Error('parentTaskKey is required');
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha ?? ''))) throw new Error('micro-sharding requires exact baseSha');

    // When an executor/task-class pairing is supplied, ask the adaptive sizer what shard-size
    // envelope this pairing has actually earned instead of always using the fixed defaults.
    let recommendation = null;
    let minLines = this.minLines; let targetLines = this.targetLines; let maxLines = this.maxLines;
    if (this.adaptiveSizer && executorId) {
      recommendation = this.adaptiveSizer.recommend({ executorId, taskClass, ...sizingFeatures });
      minLines = recommendation.minLines;
      targetLines = recommendation.targetLines;
      maxLines = recommendation.maxLines;
    }
    const normalized = units.map((unit, index) => ({
      id: String(unit.id ?? `unit-${index + 1}`),
      files: [...new Set(unit.files ?? [])].sort(),
      symbols: [...new Set(unit.symbols ?? [])].sort(),
      resources: [...new Set(unit.resources ?? [])].sort(),
      estimatedLines: Math.max(1, Number(unit.estimatedLines ?? 1)),
      estimatedMs: Math.max(1, Number(unit.estimatedMs ?? Number(unit.estimatedLines ?? 1) * 50)),
      payload: structuredClone(unit.payload ?? {})
    }));
    if (!normalized.length) return { mode: 'single', reason: 'no-decomposable-units', shards: [] };
    if (['critical', 'destructive', 'release', 'payment', 'migration'].includes(String(riskClass).toLowerCase())) return { mode: 'single', reason: 'risk-policy-disallows-micro-sharding', shards: [this.#shard(parentTaskKey, baseSha, normalized, 1)] };

    const downstream = Math.max(1, Math.min(Number(availableSlots || 1), Number(verifierSlots || 1), Number(composerSlots || 1) * 8, Number(maxShards || 1)));
    const groups = [];
    for (const unit of normalized.sort((a, b) => b.estimatedLines - a.estimatedLines || a.id.localeCompare(b.id))) {
      // Prefer maximal fan-out first: while downstream capacity remains, give the unit its
      // own shard rather than eagerly packing it into an existing group. Packing by proximity
      // to targetLines is reserved for once every available downstream slot is already in use
      // (or the unit conflicts with every open group), so a handful of tiny independent units
      // still expand to use available parallelism instead of collapsing into a single shard.
      if (groups.length < downstream && !groups.some((group) => group.some((row) => overlaps(row, unit)))) {
        groups.push([unit]);
        continue;
      }
      let candidate = groups
        .map((group, index) => ({ index, lines: group.reduce((sum, row) => sum + row.estimatedLines, 0), conflict: group.some((row) => overlaps(row, unit)) }))
        .filter((row) => !row.conflict && row.lines + unit.estimatedLines <= maxLines)
        .sort((a, b) => Math.abs((a.lines + unit.estimatedLines) - targetLines) - Math.abs((b.lines + unit.estimatedLines) - targetLines))[0];
      if (!candidate && groups.length < downstream) { groups.push([unit]); continue; }
      if (!candidate) candidate = groups.map((group, index) => ({ index, lines: group.reduce((sum, row) => sum + row.estimatedLines, 0) })).sort((a, b) => a.lines - b.lines)[0];
      groups[candidate.index].push(unit);
    }

    const shards = groups.map((group, index) => this.#shard(parentTaskKey, baseSha, group, index + 1));
    const hasMeasuredMonolithicMs = estimatedMonolithicMs != null;
    const monolithicMs = Number(estimatedMonolithicMs ?? normalized.reduce((sum, unit) => sum + unit.estimatedMs, 0));
    const parallelExecutionMs = Math.max(...shards.map((shard) => shard.estimatedMs), 0);
    const coordinationMs = shards.length * this.fixedShardOverheadMs + this.compositionOverheadMs;
    const projectedMs = parallelExecutionMs + coordinationMs;
    const projectedSavingsMs = monolithicMs - projectedMs;
    // The total-lines floor is a safety net for the case where we're projecting savings from a
    // heuristic (summed unit estimatedMs), which is unreliable for trivially small work. When the
    // caller supplies a measured estimatedMonolithicMs, the savings projection is authoritative and
    // shouldn't be overridden by a line-count proxy.
    const belowMinimumWork = !hasMeasuredMonolithicMs && normalized.reduce((sum, unit) => sum + unit.estimatedLines, 0) < minLines * 2;
    if (shards.length <= 1 || projectedSavingsMs <= 0 || belowMinimumWork) {
      return { mode: 'single', reason: 'coordination-cost-exceeds-savings', monolithicMs, projectedMs, projectedSavingsMs, sizing: recommendation, shards: [this.#shard(parentTaskKey, baseSha, normalized, 1)] };
    }
    return {
      mode: 'micro-sharded',
      reason: 'parallel-savings-positive',
      monolithicMs,
      projectedMs,
      projectedSavingsMs,
      projectedSpeedup: monolithicMs / projectedMs,
      downstreamCapacity: downstream,
      sizing: recommendation,
      shards
    };
  }

  snapshot() {
    return { version: 1, adaptiveSizer: this.adaptiveSizer ? this.adaptiveSizer.snapshot() : null };
  }

  restore(snapshot) {
    if (snapshot && snapshot.version !== 1) throw new Error('unsupported shard-planner snapshot');
    if (this.adaptiveSizer && snapshot?.adaptiveSizer) this.adaptiveSizer.restore(snapshot.adaptiveSizer);
  }

  #shard(parentTaskKey, baseSha, units, number) {
    const files = [...new Set(units.flatMap((unit) => unit.files))].sort();
    const symbols = [...new Set(units.flatMap((unit) => unit.symbols))].sort();
    const resources = [...new Set(units.flatMap((unit) => unit.resources))].sort();
    const core = { parentTaskKey, baseSha: String(baseSha).toLowerCase(), number, unitIds: units.map((unit) => unit.id).sort(), files, symbols, resources };
    return {
      shardKey: `${parentTaskKey}:shard:${number}:${digest(core).slice(0, 12)}`,
      parentTaskKey,
      baseSha: core.baseSha,
      unitIds: core.unitIds,
      scope: { files, symbols, resources },
      estimatedLines: units.reduce((sum, unit) => sum + unit.estimatedLines, 0),
      estimatedMs: units.reduce((sum, unit) => sum + unit.estimatedMs, 0),
      payloads: units.map((unit) => structuredClone(unit.payload))
    };
  }
}

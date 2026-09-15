import { buildPatchConflictGraph } from './conflict-graph.js';

function keyOf(bundle) { return bundle.shardKey ?? bundle.taskKey; }

function subsetRespectingDependencies(bundles, includeKeys) {
  const included = new Set(includeKeys);
  // A shard whose dependency is excluded cannot be composed on its own; drop it too and let a
  // later step retry without it, keeping every candidate subset internally consistent.
  let changed = true;
  while (changed) {
    changed = false;
    for (const bundle of bundles) {
      if (!included.has(keyOf(bundle))) continue;
      for (const dep of bundle.dependsOn ?? []) {
        if (!included.has(dep)) { included.delete(keyOf(bundle)); changed = true; }
      }
    }
  }
  return bundles.filter((bundle) => included.has(keyOf(bundle)));
}

/**
 * When a composed batch of accepted shards fails integration verification, automatically
 * bisect the batch to isolate the minimal failing subset instead of requiring manual diff
 * archaeology. `verify` is an injected async/sync predicate: verify(bundleSubset) => boolean
 * (true = passes integration, false = fails).
 */
export class CompositionBisector {
  constructor({ maxVerifications = 200 } = {}) {
    this.maxVerifications = Math.max(1, Number(maxVerifications));
  }

  async bisect({ bundles = [], verify, now = Date.now() } = {}) {
    if (typeof verify !== 'function') throw new Error('verify function is required');
    if (!bundles.length) throw new Error('bisect requires at least one bundle');
    const allKeys = bundles.map(keyOf);
    let verifications = 0;
    const trace = [];

    const runVerify = async (subsetBundles) => {
      if (verifications >= this.maxVerifications) throw new Error('composition bisection exceeded verification budget');
      verifications += 1;
      const keys = subsetBundles.map(keyOf).sort();
      const passed = Boolean(await verify(subsetBundles));
      trace.push({ keys, passed, at: Number(now) + verifications });
      return passed;
    };

    // Sanity: full batch should fail (that's why bisection was invoked); if it now passes,
    // there's nothing to isolate.
    const fullPasses = await runVerify(bundles);
    if (fullPasses) {
      return { minimalFailingSubset: [], allKeys, verifications, trace, note: 'full-composition-passed-on-recheck' };
    }

    // Delta-debugging style bisection (ddmin): repeatedly try to shrink the failing set by
    // halves, respecting shard dependency order so every candidate subset is composable.
    let failing = [...allKeys];
    let granularity = 2;
    while (failing.length > 1) {
      const chunkSize = Math.max(1, Math.ceil(failing.length / granularity));
      const chunks = [];
      for (let i = 0; i < failing.length; i += chunkSize) chunks.push(failing.slice(i, i + chunkSize));
      let reduced = false;

      for (const chunk of chunks) {
        const candidateBundles = subsetRespectingDependencies(bundles, chunk);
        if (!candidateBundles.length || candidateBundles.length === failing.length) continue;
        const graph = buildPatchConflictGraph(candidateBundles);
        if (graph.conflicts.length) continue; // structurally invalid subset, skip
        const passed = await runVerify(candidateBundles);
        if (!passed) { failing = candidateBundles.map(keyOf); reduced = true; break; }
      }

      if (reduced) { granularity = 2; continue; }

      // Try complements: does the batch still fail with one chunk removed?
      let complementReduced = false;
      for (const chunk of chunks) {
        const remaining = failing.filter((key) => !chunk.includes(key));
        const candidateBundles = subsetRespectingDependencies(bundles, remaining);
        if (!candidateBundles.length || candidateBundles.length === failing.length) continue;
        const graph = buildPatchConflictGraph(candidateBundles);
        if (graph.conflicts.length) continue;
        const passed = await runVerify(candidateBundles);
        if (!passed) { failing = candidateBundles.map(keyOf); complementReduced = true; break; }
      }
      if (complementReduced) { granularity = Math.max(2, granularity - 1); continue; }

      if (granularity >= failing.length) break; // fully split into singletons, can't shrink further
      granularity = Math.min(failing.length, granularity * 2);
    }

    return {
      minimalFailingSubset: failing.sort(),
      allKeys,
      verifications,
      trace,
      note: failing.length === 1 ? 'isolated-single-shard' : 'isolated-minimal-interacting-subset'
    };
  }
}

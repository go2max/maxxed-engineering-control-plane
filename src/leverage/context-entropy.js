// Context entropy scoring + splitting.
//
// Scores how "noisy" a context packet is before it is handed to an executor or
// review lens: a packet mixing unrelated files, mixed intents, wide dependency
// spread, deep history, and generated/noise content costs more tokens and more
// reviewer attention for the same signal. High-entropy packets can be split into
// tighter, coherent sub-packets along their dominant clustering axis (directory
// prefix by default, or an explicit intent tag).
//
// Deliberately NOT wired into the live dispatch/prompt-building path yet — see
// PR description. This module is additive and self-contained.

function topLevelPath(path) {
  if (!path) return '(unknown)';
  const parts = String(path).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : parts[0] ?? '(unknown)';
}

function uniqueCount(values) {
  return new Set(values.filter((value) => value !== undefined && value !== null)).size;
}

/**
 * @param {object} packet
 * @param {Array<{path?: string, intentTag?: string, dependsOn?: string[], changedAt?: number|string, generated?: boolean, noise?: boolean}>} packet.items
 * @param {Array<string|number>} [packet.history] distinct history entries (commits/sessions) touching this packet
 */
export function scoreContextEntropy(packet = {}) {
  const items = Array.isArray(packet.items) ? packet.items : [];
  const itemCount = items.length || 1;

  const dirs = items.map((item) => topLevelPath(item.path));
  const unrelatedFilesFactor = Math.min(1, uniqueCount(dirs) / itemCount);

  const intents = items.map((item) => item.intentTag ?? 'unspecified');
  const mixedIntentsFactor = Math.min(1, (uniqueCount(intents) - 1) / Math.max(1, itemCount - 1));

  const depIds = items.flatMap((item) => Array.isArray(item.dependsOn) ? item.dependsOn : []);
  const dependencySpreadFactor = itemCount <= 1 ? 0 : Math.min(1, uniqueCount(depIds) / (itemCount * 2));

  const history = Array.isArray(packet.history) && packet.history.length
    ? packet.history
    : items.map((item) => item.changedAt).filter((value) => value !== undefined && value !== null);
  const historyDepthFactor = Math.min(1, uniqueCount(history) / 8);

  const noisyCount = items.filter((item) => item.generated || item.noise).length;
  const noiseRatioFactor = itemCount ? noisyCount / itemCount : 0;

  const factors = {
    unrelatedFiles: unrelatedFilesFactor,
    mixedIntents: mixedIntentsFactor,
    dependencySpread: dependencySpreadFactor,
    historyDepth: historyDepthFactor,
    noiseRatio: noiseRatioFactor
  };

  const weights = {
    unrelatedFiles: 0.28,
    mixedIntents: 0.24,
    dependencySpread: 0.18,
    historyDepth: 0.12,
    noiseRatio: 0.18
  };

  const score = Object.keys(weights).reduce((sum, key) => sum + factors[key] * weights[key], 0);

  const level = score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low';

  return {
    score: Math.round(score * 1000) / 1000,
    level,
    factors,
    itemCount: items.length
  };
}

/**
 * Splits a high-entropy packet into coherent sub-packets along a clustering key
 * (default: top-level directory of `path`; pass `by: 'intent'` to cluster on
 * `intentTag` instead). Packets scoring below `threshold` are returned unsplit
 * (as a single-element array) since splitting a low-entropy packet only adds
 * overhead without narrowing anything meaningful.
 *
 * @param {object} packet
 * @param {{threshold?: number, by?: 'path'|'intent', minClusterSize?: number}} [options]
 * @returns {{split: boolean, entropy: object, packets: object[]}}
 */
export function splitByEntropy(packet = {}, { threshold = 0.6, by = 'path', minClusterSize = 1 } = {}) {
  const entropy = scoreContextEntropy(packet);
  const items = Array.isArray(packet.items) ? packet.items : [];

  if (entropy.score < threshold || items.length <= 1) {
    return { split: false, entropy, packets: [packet] };
  }

  const keyFor = by === 'intent'
    ? (item) => item.intentTag ?? 'unspecified'
    : (item) => topLevelPath(item.path);

  const clusters = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(item);
  }

  // Clusters too small to stand alone fold into a shared "misc" bucket so we
  // don't explode a packet into dozens of single-item slivers.
  const kept = [];
  const misc = [];
  for (const [key, clusterItems] of clusters) {
    if (clusterItems.length >= minClusterSize && clusters.size > 1) kept.push([key, clusterItems]);
    else misc.push(...clusterItems);
  }
  if (misc.length) kept.push(['misc', misc]);

  if (kept.length <= 1) {
    return { split: false, entropy, packets: [packet] };
  }

  const packets = kept.map(([key, clusterItems]) => ({
    ...packet,
    splitKey: key,
    splitBy: by,
    items: clusterItems,
    parentObjective: packet.objective ?? null
  }));

  return { split: true, entropy, packets };
}

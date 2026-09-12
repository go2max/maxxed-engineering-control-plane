export function downstreamDepth(graph, key, memo = new Map()) {
  if (memo.has(key)) return memo.get(key);
  const dependents = graph.dependentsOf(key);
  const depth = dependents.length ? 1 + Math.max(...dependents.map((task) => downstreamDepth(graph, task.key, memo))) : 0;
  memo.set(key, depth);
  return depth;
}

export function criticalPathScore(graph, key) {
  const depth = downstreamDepth(graph, key);
  const unlocks = graph.unlockCount(key);
  return { depth, unlocks, score: depth * 25 + unlocks * 10 };
}

export function portfolioFairnessPenalty(task, activeClaims, { perProductSoftLimit = 2, perRepoSoftLimit = 2 } = {}) {
  const repo = task.repository ?? null;
  const product = task.product ?? null;
  const repoActive = repo ? activeClaims.filter((claim) => claim.repository === repo).length : 0;
  const productActive = product ? activeClaims.filter((claim) => claim.product === product).length : 0;
  const repoPenalty = Math.max(0, repoActive - perRepoSoftLimit + 1) * 15;
  const productPenalty = Math.max(0, productActive - perProductSoftLimit + 1) * 15;
  return { repoActive, productActive, repoPenalty, productPenalty, total: repoPenalty + productPenalty };
}

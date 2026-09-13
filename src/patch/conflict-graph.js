function intersects(a = [], b = []) {
  const right = new Set(b);
  return a.some((value) => right.has(value));
}

function reachable(from, to, byKey, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const dep of byKey.get(from)?.dependsOn ?? []) if (reachable(dep, to, byKey, seen)) return true;
  return false;
}

export function patchBundlesConflict(left, right, { allowOrderedSameFile = true } = {}) {
  const leftKey = left.shardKey ?? left.taskKey;
  const rightKey = right.shardKey ?? right.taskKey;
  if (leftKey === rightKey) return { conflict: true, reasons: ['duplicate-shard-key'] };
  const byKey = new Map([[leftKey, left], [rightKey, right]]);
  const ordered = allowOrderedSameFile && (reachable(leftKey, rightKey, byKey) || reachable(rightKey, leftKey, byKey));
  const reasons = [];
  if (!ordered && intersects(left.scope?.files ?? [], right.scope?.files ?? [])) reasons.push('file-overlap');
  if (!ordered && intersects(left.scope?.symbols ?? [], right.scope?.symbols ?? [])) reasons.push('symbol-overlap');
  if (intersects(left.scope?.resources ?? [], right.scope?.resources ?? [])) reasons.push('resource-overlap');
  if (left.scope?.component && right.scope?.component && left.scope.component === right.scope.component && !ordered && (left.scope?.files?.length === 0 || right.scope?.files?.length === 0)) reasons.push('component-overlap');
  return { conflict: reasons.length > 0, reasons };
}

export function buildPatchConflictGraph(bundles = []) {
  const rows = bundles.map((bundle) => ({ key: bundle.shardKey ?? bundle.taskKey, bundle }));
  const keys = new Set(rows.map((row) => row.key));
  if (keys.size !== rows.length) throw new Error('duplicate shard keys in patch set');
  const edges = [];
  const conflicts = [];
  for (const row of rows) for (const dep of row.bundle.dependsOn ?? []) {
    if (!keys.has(dep)) throw new Error(`unknown shard dependency: ${row.key} -> ${dep}`);
    edges.push({ from: dep, to: row.key, type: 'depends-on' });
  }
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const verdict = patchBundlesConflict(rows[i].bundle, rows[j].bundle);
      if (verdict.conflict) conflicts.push({ left: rows[i].key, right: rows[j].key, reasons: verdict.reasons });
    }
  }
  const inDegree = new Map(rows.map((row) => [row.key, 0]));
  const out = new Map(rows.map((row) => [row.key, []]));
  for (const edge of edges) { inDegree.set(edge.to, inDegree.get(edge.to) + 1); out.get(edge.from).push(edge.to); }
  const queue = [...inDegree.entries()].filter(([, count]) => count === 0).map(([key]) => key).sort();
  const order = [];
  while (queue.length) {
    const key = queue.shift(); order.push(key);
    for (const next of out.get(key) ?? []) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) { queue.push(next); queue.sort(); }
    }
  }
  if (order.length !== rows.length) throw new Error('patch shard dependency cycle detected');
  return { nodes: rows.map((row) => row.key).sort(), edges, conflicts, order };
}

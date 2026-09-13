function edgeKey(from, type, to) { return `${from}\u0000${type}\u0000${to}`; }

export class SemanticCodeGraph {
  constructor() { this.nodes = new Map(); this.edges = new Map(); this.out = new Map(); this.in = new Map(); }

  upsertNode(node) {
    if (!node?.id || !node?.kind) throw new Error('node id and kind are required');
    const row = { ...structuredClone(this.nodes.get(node.id) ?? {}), ...structuredClone(node) };
    this.nodes.set(node.id, row); return structuredClone(row);
  }

  addEdge({ from, to, type, metadata = {} } = {}) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) throw new Error('edge endpoints must exist');
    if (!type) throw new Error('edge type is required');
    const key = edgeKey(from, type, to); const row = { from, to, type, metadata: structuredClone(metadata) };
    this.edges.set(key, row);
    if (!this.out.has(from)) this.out.set(from, new Set()); if (!this.in.has(to)) this.in.set(to, new Set());
    this.out.get(from).add(key); this.in.get(to).add(key); return structuredClone(row);
  }

  dependencySlice(seedIds = [], { depth = 2, edgeTypes = null, maxNodes = 200 } = {}) {
    const allowed = edgeTypes ? new Set(edgeTypes) : null; const queue = seedIds.map((id) => ({ id, d: 0 })); const seen = new Set();
    while (queue.length && seen.size < maxNodes) {
      const { id, d } = queue.shift(); if (seen.has(id) || !this.nodes.has(id)) continue; seen.add(id); if (d >= depth) continue;
      const keys = new Set([...(this.out.get(id) ?? []), ...(this.in.get(id) ?? [])]);
      for (const key of keys) { const edge = this.edges.get(key); if (allowed && !allowed.has(edge.type)) continue; queue.push({ id: edge.from === id ? edge.to : edge.from, d: d + 1 }); }
    }
    const nodes = [...seen].map((id) => structuredClone(this.nodes.get(id)));
    const edges = [...this.edges.values()].filter((edge) => seen.has(edge.from) && seen.has(edge.to) && (!allowed || allowed.has(edge.type))).map((edge) => structuredClone(edge));
    return { seedIds: [...seedIds], nodes, edges };
  }

  impactedBy(nodeIds = [], options = {}) { return this.dependencySlice(nodeIds, { depth: options.depth ?? 3, edgeTypes: options.edgeTypes ?? ['imports','references','calls','tests','implements','depends-on'], maxNodes: options.maxNodes ?? 500 }); }
  snapshot() { return { version: 1, nodes: [...this.nodes.values()].map((node) => structuredClone(node)), edges: [...this.edges.values()].map((edge) => structuredClone(edge)) }; }
  restore(snapshot) { this.nodes.clear(); this.edges.clear(); this.out.clear(); this.in.clear(); for (const node of snapshot?.nodes ?? []) this.upsertNode(node); for (const edge of snapshot?.edges ?? []) this.addEdge(edge); }
}

export class ContextCompiler {
  constructor({ graph, cas, repairs } = {}) { this.graph = graph; this.cas = cas; this.repairs = repairs; }

  compile({ taskClass = 'coding', objective, dependencySeeds = [], failureFingerprint = null, maxGraphNodes = 80, maxExamples = 4 } = {}) {
    if (!objective) throw new Error('objective is required');
    const slice = this.graph?.dependencySlice(dependencySeeds, { depth: 2, maxNodes: maxGraphNodes }) ?? { nodes: [], edges: [] };
    const examples = this.cas?.findByTag([taskClass], { minConfidence: 0.7, limit: maxExamples }) ?? [];
    const repairs = failureFingerprint ? (this.repairs?.recall(failureFingerprint, { limit: maxExamples }) ?? []) : [];
    return {
      objective,
      taskClass,
      codeContext: {
        nodes: slice.nodes.map((node) => ({ id: node.id, kind: node.kind, path: node.path ?? null, name: node.name ?? null, language: node.language ?? null })),
        edges: slice.edges.map((edge) => ({ from: edge.from, to: edge.to, type: edge.type }))
      },
      provenExamples: examples.map((row) => ({ key: row.key, result: row.result, confidence: row.confidence })),
      repairHints: repairs.map((row) => ({ fingerprint: row.fingerprint, repairPlan: row.repairPlan, patchSummary: row.patchSummary, commitSha: row.commitSha })),
      stats: { graphNodes: slice.nodes.length, graphEdges: slice.edges.length, examples: examples.length, repairHints: repairs.length }
    };
  }
}

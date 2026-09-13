function estimateTokens(value) { return Math.ceil(Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') / 4); }

export class ContextCompiler {
  constructor({ graph, cas, repairs } = {}) { this.graph = graph; this.cas = cas; this.repairs = repairs; }

  compile({ taskClass = 'coding', objective, dependencySeeds = [], failureFingerprint = null, sourceSha = null, maxGraphNodes = 80, maxExamples = 4, tokenBudget = 8_000 } = {}) {
    if (!objective) throw new Error('objective is required');
    if (sourceSha && !/^[0-9a-f]{40}$/i.test(String(sourceSha))) throw new Error('sourceSha must be an exact commit SHA');
    const slice = this.graph?.dependencySlice(dependencySeeds, { depth: 2, maxNodes: maxGraphNodes }) ?? { nodes: [], edges: [] };
    const nodes = slice.nodes.filter((node) => !sourceSha || !node.sourceSha || node.sourceSha === sourceSha);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = slice.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    const staleNodes = slice.nodes.filter((node) => sourceSha && node.sourceSha && node.sourceSha !== sourceSha).length;
    const examples = this.cas?.findByTag([taskClass], { minConfidence: 0.7, limit: maxExamples }) ?? [];
    const repairs = failureFingerprint ? (this.repairs?.recall(failureFingerprint, { limit: maxExamples }) ?? []) : [];
    const result = {
      objective,
      taskClass,
      sourceSha,
      codeContext: {
        nodes: nodes.map((node) => ({ id: node.id, kind: node.kind, path: node.path ?? null, name: node.name ?? null, language: node.language ?? null, sourceSha: node.sourceSha ?? null })),
        edges: edges.map((edge) => ({ from: edge.from, to: edge.to, type: edge.type }))
      },
      provenExamples: examples.map((row) => ({ key: row.key, result: row.result, confidence: row.confidence })),
      repairHints: repairs.map((row) => ({ fingerprint: row.fingerprint, repairPlan: row.repairPlan, patchSummary: row.patchSummary, commitSha: row.commitSha })),
      freshness: { exactSourceRequired: Boolean(sourceSha), staleNodesDiscarded: staleNodes }
    };
    const budget = Math.max(512, Number(tokenBudget));
    const trimOne = () => {
      if (result.provenExamples.length) { result.provenExamples.pop(); return true; }
      if (result.repairHints.length) { result.repairHints.pop(); return true; }
      if (result.codeContext.edges.length) { result.codeContext.edges.pop(); return true; }
      if (result.codeContext.nodes.length) { const removed = result.codeContext.nodes.pop(); result.codeContext.edges = result.codeContext.edges.filter((edge) => edge.from !== removed.id && edge.to !== removed.id); return true; }
      return false;
    };
    while (estimateTokens(result) > budget && trimOne()) {}
    result.stats = {
      graphNodes: result.codeContext.nodes.length,
      graphEdges: result.codeContext.edges.length,
      examples: result.provenExamples.length,
      repairHints: result.repairHints.length,
      estimatedTokens: estimateTokens(result),
      tokenBudget: budget,
      staleNodesDiscarded: staleNodes
    };
    return result;
  }
}

export class ImpactTestSelector {
  constructor({ graph } = {}) { if (!graph) throw new Error('graph is required'); this.graph = graph; }

  select({ changedNodeIds = [], riskClass = 'normal', fullSuiteTests = [], maxImpactedNodes = 1000, requireFullFor = ['critical','security','payment','migration','release'] } = {}) {
    const risk = String(riskClass).toLowerCase();
    if (requireFullFor.map(String).map((value) => value.toLowerCase()).includes(risk)) return { mode: 'full', reason: `risk:${risk}`, tests: [...new Set(fullSuiteTests)].sort(), impacted: null };
    const impacted = this.graph.impactedBy(changedNodeIds, { depth: 4, maxNodes: maxImpactedNodes });
    const tests = impacted.nodes
      .filter((node) => node.kind === 'test' || /(?:^|\/)(?:test|tests|__tests__)\//i.test(node.path ?? '') || /(?:\.test|\.spec)\.[^.]+$/i.test(node.path ?? ''))
      .map((node) => node.path ?? node.id);
    const unique = [...new Set(tests)].sort();
    if (!unique.length) return { mode: 'full', reason: 'no-impact-tests-found', tests: [...new Set(fullSuiteTests)].sort(), impacted };
    return { mode: 'targeted', reason: 'semantic-impact', tests: unique, impacted };
  }
}

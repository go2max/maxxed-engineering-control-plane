import { solutionKey } from './solution-cas.js';

export const LeverageStrategy = Object.freeze({ EXACT_REUSE: 'EXACT_REUSE', DETERMINISTIC_TRANSFORM: 'DETERMINISTIC_TRANSFORM', RETRIEVAL_ASSISTED: 'RETRIEVAL_ASSISTED', NOVEL_REASONING: 'NOVEL_REASONING' });

export class LeverageEngine {
  constructor({ cas, graph, transforms, repairs } = {}) { this.cas = cas; this.graph = graph; this.transforms = transforms; this.repairs = repairs; }

  plan({ taskClass = 'standard', normalizedSpec, dependencySeeds = [], context = {}, failureFingerprint = null, environment = null, policyVersion = null, exactReuseAllowed = true } = {}) {
    if (!normalizedSpec) throw new Error('normalizedSpec is required');
    const dependencySlice = this.graph?.dependencySlice(dependencySeeds, { depth: 2, maxNodes: 200 }) ?? null;
    const keyInput = { taskClass, normalizedSpec, dependencySlice, environment, policyVersion };
    const exact = exactReuseAllowed ? this.cas?.get(keyInput) : null;
    if (exact) return { strategy: LeverageStrategy.EXACT_REUSE, solutionKey: exact.key, exact, dependencySlice, estimatedReasoningUnits: 0 };

    const transformCandidates = this.transforms?.candidates({ taskClass, normalizedSpec, dependencySlice, ...context }) ?? [];
    if (transformCandidates.length) return { strategy: LeverageStrategy.DETERMINISTIC_TRANSFORM, solutionKey: solutionKey(keyInput), transformId: transformCandidates[0].id, candidates: transformCandidates.map((t) => t.id), dependencySlice, estimatedReasoningUnits: 0.05 };

    const rememberedRepairs = failureFingerprint ? (this.repairs?.recall(failureFingerprint, { limit: 3 }) ?? []) : [];
    const semantic = this.cas?.findByTag([taskClass], { minConfidence: 0.7, limit: 5 }) ?? [];
    if (rememberedRepairs.length || semantic.length) return { strategy: LeverageStrategy.RETRIEVAL_ASSISTED, solutionKey: solutionKey(keyInput), rememberedRepairs, semanticExamples: semantic, dependencySlice, estimatedReasoningUnits: 0.25 };

    return { strategy: LeverageStrategy.NOVEL_REASONING, solutionKey: solutionKey(keyInput), dependencySlice, estimatedReasoningUnits: 1 };
  }

  async executeTransform(plan, context) {
    if (plan?.strategy !== LeverageStrategy.DETERMINISTIC_TRANSFORM) throw new Error('plan is not a deterministic transform');
    return this.transforms.execute(plan.transformId, context);
  }
}

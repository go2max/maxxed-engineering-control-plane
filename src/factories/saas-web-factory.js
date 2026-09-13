import { buildBaselineContract } from './saas-baseline.js';

export const WebFactoryStage = Object.freeze({
  SPEC: 'SPEC',
  IMPLEMENT: 'IMPLEMENT',
  UNIT_API: 'UNIT_API',
  BROWSER: 'BROWSER',
  ACCESSIBILITY: 'ACCESSIBILITY',
  SECURITY: 'SECURITY',
  STAGING: 'STAGING',
  VISUAL_VERIFY: 'VISUAL_VERIFY',
  ACCEPT: 'ACCEPT'
});

const ORDER = Object.values(WebFactoryStage);

export class SaasWebFactory {
  createRun(input) {
    if (!input?.productKey || !input?.repository) throw new Error('productKey and repository are required');
    const spec = input.spec ?? {};
    const baseline = buildBaselineContract({ productKey: input.productKey, repository: input.repository, spec });
    return {
      runId: input.runId ?? `${input.productKey}:${Date.now()}`,
      productKey: input.productKey,
      repository: input.repository,
      spec,
      specDigest: baseline.specification.digest,
      baseline,
      stageIndex: 0,
      state: 'RUNNING',
      evidence: {},
      failures: []
    };
  }

  currentStage(run) { return ORDER[run.stageIndex] ?? null; }

  record(run, stage, evidence) {
    if (run.state !== 'RUNNING') throw new Error(`run is ${run.state}`);
    const current = this.currentStage(run);
    if (stage !== current) throw new Error(`expected stage ${current}, received ${stage}`);
    run.evidence[stage] = structuredClone(evidence ?? {});
    if (evidence?.ok === false) {
      run.state = 'FAILED';
      run.failures.push({ stage, evidence: structuredClone(evidence) });
      return structuredClone(run);
    }
    if (stage === WebFactoryStage.SPEC && evidence?.requirementsHash && evidence.requirementsHash !== run.specDigest) {
      throw new Error('SPEC evidence requirementsHash does not match canonical spec digest');
    }
    run.stageIndex += 1;
    if (run.stageIndex >= ORDER.length) run.state = 'ACCEPTED';
    return structuredClone(run);
  }

  requiredTaskTemplates(run) {
    return ORDER.map((stage, index) => ({
      key: `${run.runId}:${stage.toLowerCase()}`,
      repository: run.repository,
      product: run.productKey,
      objective: `${stage} stage for ${run.productKey}`,
      dependencies: index ? [`${run.runId}:${ORDER[index - 1].toLowerCase()}`] : [],
      taskClass: stage === WebFactoryStage.BROWSER || stage === WebFactoryStage.VISUAL_VERIFY ? 'browser' : 'standard',
      requirements: stage === WebFactoryStage.BROWSER || stage === WebFactoryStage.VISUAL_VERIFY ? { capabilities: ['browser'] } : {},
      dedupeKey: `${run.productKey}:${run.specDigest}:${stage}`,
      metadata: { factory: 'saas-web', factoryRunId: run.runId, stage, specDigest: run.specDigest, baselineVersion: run.baseline.specification.baselineVersion, productDelta: run.baseline.productDelta }
    }));
  }
}

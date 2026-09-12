import { validateStageEvidence, semanticJobForStage } from './web-stage-contracts.js';

export class WebFactoryExecutor {
  constructor({ factory, repairPlanner = null } = {}) {
    if (!factory) throw new Error('factory is required');
    this.factory = factory;
    this.repairPlanner = repairPlanner;
  }

  nextJob(run) {
    if (run.state !== 'RUNNING') return null;
    const stage = this.factory.currentStage(run);
    return stage ? semanticJobForStage(run, stage) : null;
  }

  applyEvidence(run, evidence) {
    if (run.state !== 'RUNNING') throw new Error(`run is ${run.state}`);
    const stage = this.factory.currentStage(run);
    const validation = validateStageEvidence(stage, evidence);
    if (!validation.ok) {
      const failure = { stage, class: this.#failureClass(stage), message: validation.reason, evidence: structuredClone(evidence) };
      const next = this.factory.record(run, stage, { ...evidence, ok: false, reason: validation.reason });
      const repairPlan = this.repairPlanner ? this.repairPlanner(failure) : null;
      return { run: next, validation, failure, repairPlan };
    }
    const next = this.factory.record(run, stage, { ...evidence, ok: true });
    return { run: next, validation, failure: null, repairPlan: null };
  }

  productionVerificationHandoff(run, production) {
    if (run.state !== 'ACCEPTED') throw new Error('only accepted factory runs may request production verification');
    if (!production?.url || !production?.commitSha) throw new Error('production url and commitSha are required');
    const acceptedSha = run.evidence?.ACCEPT?.acceptedCommitSha;
    if (acceptedSha && acceptedSha !== production.commitSha) throw new Error('production commit does not match accepted commit');
    return {
      kind: 'production-verification',
      productKey: run.productKey,
      repository: run.repository,
      factoryRunId: run.runId,
      url: production.url,
      commitSha: production.commitSha,
      checks: ['health', 'browser-smoke', 'console-errors', 'critical-api', 'visual-sanity'],
      requiresExactAcceptedSha: true
    };
  }

  #failureClass(stage) {
    if (stage === 'SECURITY') return 'SECURITY_FAILURE';
    if (stage === 'STAGING') return 'INFRASTRUCTURE_FAILURE';
    if (['UNIT_API', 'BROWSER', 'ACCESSIBILITY', 'VISUAL_VERIFY'].includes(stage)) return 'TEST_FAILURE';
    return 'BUILD_FAILURE';
  }
}

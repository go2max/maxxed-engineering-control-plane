import { WebFactoryStage } from './saas-web-factory.js';

const CONTRACTS = Object.freeze({
  [WebFactoryStage.SPEC]: { requiredEvidence: ['specId', 'requirementsHash'], jobKind: 'planning', capabilities: [] },
  [WebFactoryStage.IMPLEMENT]: { requiredEvidence: ['commitSha', 'changedFiles'], jobKind: 'code', capabilities: ['code'] },
  [WebFactoryStage.UNIT_API]: { requiredEvidence: ['testCommand', 'passed', 'failed'], jobKind: 'test', capabilities: ['node'] },
  [WebFactoryStage.BROWSER]: { requiredEvidence: ['baseUrl', 'scenarios', 'passed', 'failed'], jobKind: 'browser-test', capabilities: ['browser'] },
  [WebFactoryStage.ACCESSIBILITY]: { requiredEvidence: ['standard', 'violations'], jobKind: 'accessibility', capabilities: ['browser'] },
  [WebFactoryStage.SECURITY]: { requiredEvidence: ['scanner', 'critical', 'high'], jobKind: 'security', capabilities: [] },
  [WebFactoryStage.STAGING]: { requiredEvidence: ['deploymentId', 'url', 'commitSha'], jobKind: 'staging-deploy', capabilities: ['deploy'] },
  [WebFactoryStage.VISUAL_VERIFY]: { requiredEvidence: ['baseUrl', 'screenshots', 'consoleErrors'], jobKind: 'visual-verify', capabilities: ['browser'] },
  [WebFactoryStage.ACCEPT]: { requiredEvidence: ['acceptedCommitSha', 'acceptanceBundleId'], jobKind: 'acceptance', capabilities: [] }
});

export function stageContract(stage) {
  const contract = CONTRACTS[stage];
  if (!contract) throw new Error(`unknown web factory stage: ${stage}`);
  return structuredClone(contract);
}

export function validateStageEvidence(stage, evidence = {}) {
  const contract = stageContract(stage);
  const missing = contract.requiredEvidence.filter((field) => !(field in evidence));
  if (missing.length) return { ok: false, missing, reason: `missing evidence: ${missing.join(', ')}` };
  if (evidence.ok === false) return { ok: false, missing: [], reason: evidence.reason ?? 'stage reported failure' };
  if (stage === WebFactoryStage.UNIT_API && Number(evidence.failed ?? 0) > 0) return { ok: false, missing: [], reason: 'tests failed' };
  if (stage === WebFactoryStage.BROWSER && Number(evidence.failed ?? 0) > 0) return { ok: false, missing: [], reason: 'browser scenarios failed' };
  if (stage === WebFactoryStage.ACCESSIBILITY && Number(evidence.violations ?? 0) > 0) return { ok: false, missing: [], reason: 'accessibility violations remain' };
  if (stage === WebFactoryStage.SECURITY && (Number(evidence.critical ?? 0) > 0 || Number(evidence.high ?? 0) > 0)) return { ok: false, missing: [], reason: 'high-severity security findings remain' };
  if (stage === WebFactoryStage.VISUAL_VERIFY && Number(evidence.consoleErrors ?? 0) > 0) return { ok: false, missing: [], reason: 'browser console errors remain' };
  return { ok: true, missing: [], reason: 'stage evidence accepted' };
}

export function semanticJobForStage(run, stage) {
  const contract = stageContract(stage);
  return {
    kind: contract.jobKind,
    productKey: run.productKey,
    repository: run.repository,
    runId: run.runId,
    stage,
    requirements: { capabilities: contract.capabilities },
    inputs: {
      spec: stage === WebFactoryStage.SPEC ? run.spec : undefined,
      previousEvidence: run.evidence ?? {}
    },
    expectedEvidence: contract.requiredEvidence
  };
}

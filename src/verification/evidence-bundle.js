import { createHash } from 'node:crypto';
import { buildRepairPlan, fingerprintFailure } from './failure-fingerprint.js';
import { TaskStage } from '../scheduler/task-stage.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function buildEvidenceBundle({ taskKey, acceptance = {}, evidence = {}, verification = {}, producerId = null, verifierId = null, now = Date.now() } = {}) {
  if (!taskKey) throw new Error('taskKey is required');
  const payload = canonical({ taskKey, acceptance, evidence, verification, producerId, verifierId });
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { version: 1, taskKey, producerId, verifierId, capturedAt: now, digest, payload };
}

export function synthesizeRepairTask({ task, verification, evidence = {}, attempt = 1 } = {}) {
  if (!task?.key) throw new Error('task is required');
  const failedCheck = verification?.failed?.[0] ?? 'unknown';
  const failureClass = verification?.failureClasses?.[0] ?? 'UNKNOWN';
  const failure = { class: failureClass, check: failedCheck, message: verification?.reason ?? 'verification failure' };
  const plan = buildRepairPlan(failure);
  const fingerprint = fingerprintFailure(failure);
  const key = `${task.key}:repair:${attempt}:${fingerprint.slice(0, 12)}`;
  const originalExecution = task.metadata?.execution;
  const codingRepair = originalExecution?.kind === 'coding-agent' ? {
    ...structuredClone(originalExecution),
    taskKey: key,
    branchBase: `${originalExecution.branchBase ?? 'maxxed/agent/repair'}-repair-${attempt}`,
    ref: evidence?.artifacts?.commitSha ?? originalExecution.ref ?? 'HEAD',
    goal: `Repair ${task.key}. Failure class: ${failureClass}. Failed check: ${failedCheck}. ${verification?.reason ?? ''} Repair plan: ${(plan?.steps ?? []).join('; ')}`,
    autoCommit: true,
    autoPush: true
  } : null;
  return {
    key,
    repository: task.repository,
    product: task.product,
    objective: `Repair ${task.key} after ${failureClass}`,
    dependencies: [],
    taskClass: 'repair',
    requirements: task.requirements ?? {},
    dedupeKey: `${task.key}:repair:${fingerprint}`,
    state: 'READY',
    metadata: {
      stage: TaskStage.REPAIR,
      repairOf: task.key,
      repairAttempt: attempt,
      failureFingerprint: fingerprint,
      repairPlan: plan,
      restartable: true,
      closesParentOnAccept: Boolean(codingRepair),
      acceptance: task.metadata?.acceptance ?? {},
      ...(task.metadata?.modelRequest ? { modelRequest: structuredClone(task.metadata.modelRequest) } : {}),
      ...(codingRepair ? { execution: codingRepair, mutationScopes: task.metadata?.mutationScopes ?? [] } : {})
    }
  };
}

export function buildReconciliationRequirement({ taskKey, verification, evidenceBundle } = {}) {
  if (!taskKey) throw new Error('taskKey is required');
  const external = (verification?.failureClasses ?? []).includes('EXTERNAL_STATE_UNCERTAIN');
  if (!external) return null;
  return {
    kind: 'external-state-reconciliation',
    taskKey,
    evidenceDigest: evidenceBundle?.digest ?? null,
    requiredSteps: ['read-authoritative-external-state', 'compare-intended-vs-observed', 'record-reconciliation-evidence', 'resume-only-after-state-known'],
    completed: false
  };
}

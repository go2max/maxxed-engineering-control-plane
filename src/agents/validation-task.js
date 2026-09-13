const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_STEPS = 32;

function capabilityFor(command) {
  if (command === 'python3') return 'python';
  if (command === 'npx') return 'npm';
  return command;
}

export function compileValidationTask({
  key, repository, ref, repoPath = null, steps = [], dependencies = [], priority = 0,
  riskClass = 'normal', requirements = {}, failFast = true
} = {}) {
  if (!key) throw new Error('validation task key is required');
  if (!repository) throw new Error('validation repository is required');
  if (!SHA40.test(String(ref ?? ''))) throw new Error('validation task requires exact 40-character ref');
  if (!Array.isArray(steps) || !steps.length) throw new Error('validation task requires at least one step');
  if (steps.length > MAX_STEPS) throw new Error('validation task step count exceeds limit');
  const normalizedSteps = steps.map((step, index) => {
    if (!step?.command || typeof step.command !== 'string') throw new Error(`validation step ${index + 1} command is required`);
    if (!Array.isArray(step.args ?? []) || (step.args ?? []).some((arg) => typeof arg !== 'string')) throw new Error(`validation step ${index + 1} args must be strings`);
    return {
      name: String(step.name ?? `step-${index + 1}`),
      command: step.command,
      args: [...(step.args ?? [])],
      ...(step.timeoutMs != null ? { timeoutMs: Number(step.timeoutMs) } : {}),
      ...(step.env ? { env: structuredClone(step.env) } : {})
    };
  });
  const capabilities = [...new Set(['git', ...normalizedSteps.map((step) => capabilityFor(step.command)), ...(requirements.capabilities ?? [])])];
  const requiredChecks = normalizedSteps.map((step) => step.name);
  return {
    key: String(key),
    repository: String(repository),
    objective: `Validate ${repository}@${String(ref).toLowerCase()}`,
    dependencies: [...new Set(dependencies.map(String))],
    riskClass,
    taskClass: 'validation',
    requirements: { ...structuredClone(requirements), capabilities },
    dedupeKey: `validation:${repository}:${String(ref).toLowerCase()}:${key}`,
    state: 'READY',
    metadata: {
      priority: Number(priority),
      restartable: true,
      suppressPromotion: true,
      acceptance: { requiredChecks, requireIndependentVerifier: false },
      execution: {
        kind: 'validation-agent',
        repoPath,
        ref: String(ref).toLowerCase(),
        steps: normalizedSteps,
        failFast: failFast !== false,
        taskKey: String(key)
      }
    }
  };
}

export function fabricValidationTaskFromDispatch(task, dispatch) {
  const execution = task?.metadata?.execution;
  if (!execution || execution.kind !== 'validation-agent') throw new Error('task is not compiled for validation-agent execution');
  if (!dispatch?.claim?.claimId || !dispatch.workerId) throw new Error('dispatch claim and worker are required');
  return {
    taskId: dispatch.claim.claimId,
    repository: task.repository,
    preferredWorkerId: dispatch.workerId,
    priority: Number(task.metadata?.priority ?? 0),
    restartable: task.metadata?.restartable !== false,
    requirements: task.requirements,
    payload: {
      ...execution,
      kind: 'validation-agent',
      controlPlaneTaskKey: task.key,
      controlPlaneClaim: dispatch.claim
    }
  };
}

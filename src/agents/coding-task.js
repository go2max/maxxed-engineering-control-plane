function slug(value) {
  return String(value ?? 'task').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'task';
}

export function compileCodingTask({
  key, repository, repoPath, objective, acceptance = {}, testCommands = [], dependencies = [],
  priority = 0, riskClass = 'normal', taskClass = 'standard', ref = 'HEAD', maxSteps = 24,
  autoCommit = true, autoPush = true, branchPrefix = 'maxxed/agent'
} = {}) {
  if (!key) throw new Error('coding task key is required');
  if (!repository) throw new Error('repository is required');
  if (!repoPath) throw new Error('repoPath is required');
  if (!objective) throw new Error('objective is required');
  if (!Array.isArray(testCommands)) throw new Error('testCommands must be an array');
  const branchBase = `${branchPrefix}/${slug(key)}`;
  const requiredChecks = acceptance.requiredChecks ?? testCommands.map((entry, index) => entry.name ?? `test-${index + 1}`);
  const normalizedAcceptance = {
    requiredChecks,
    requireIndependentVerifier: riskClass === 'high' || riskClass === 'critical' || acceptance.requireIndependentVerifier === true,
    ...acceptance
  };
  return {
    key,
    repository,
    objective,
    dependencies,
    riskClass,
    taskClass,
    requirements: { capabilities: ['coding-agent', 'git', 'node'], minMemoryMb: 2048 },
    dedupeKey: `coding:${repository}:${key}`,
    state: 'READY',
    metadata: {
      priority,
      restartable: true,
      mutationScopes: [`repo:${repository}`, `branch-base:${repository}:${branchBase}`],
      acceptance: normalizedAcceptance,
      execution: {
        kind: 'coding-agent',
        repoPath,
        ref,
        branchBase,
        goal: objective,
        acceptance: normalizedAcceptance,
        testCommands,
        maxSteps: Math.max(1, Math.min(64, Number(maxSteps))),
        autoCommit: Boolean(autoCommit),
        autoPush: Boolean(autoPush),
        commitMessage: `maxxed: ${String(objective).slice(0, 120)}`,
        taskKey: key
      }
    }
  };
}

export function fabricTaskFromDispatch(task, dispatch) {
  const execution = task?.metadata?.execution;
  if (!execution || execution.kind !== 'coding-agent') throw new Error('task is not compiled for coding-agent execution');
  if (!dispatch?.claim?.claimId || !dispatch.workerId) throw new Error('dispatch claim and worker are required');
  const generation = Number(dispatch.claim.generation ?? 0);
  const branchName = `${execution.branchBase}-g${generation}`;
  return {
    taskId: dispatch.claim.claimId,
    repository: task.repository,
    preferredWorkerId: dispatch.workerId,
    priority: Number(task.metadata?.priority ?? 0),
    restartable: task.metadata?.restartable !== false,
    requirements: task.requirements,
    payload: {
      ...execution,
      branchName,
      publishAfterLeaseValidation: Boolean(execution.autoPush),
      autoPush: false,
      controlPlaneTaskKey: task.key,
      controlPlaneClaim: dispatch.claim
    }
  };
}

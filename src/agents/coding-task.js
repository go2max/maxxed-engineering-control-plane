import { TaskStage } from '../scheduler/task-stage.js';

function slug(value) {
  return String(value ?? 'task').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'task';
}

export function compileCodingTask({
  key, repository, repoPath = null, objective, acceptance = {}, testCommands = [], dependencies = [],
  priority = 0, riskClass = 'normal', taskClass = 'standard', ref = 'HEAD', baseBranch = 'main', maxSteps = 24,
  autoCommit = true, autoPush = true, branchPrefix = 'maxxed/agent', modelRequest = null, microSharding = null
} = {}) {
  if (!key) throw new Error('coding task key is required');
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository))) throw new Error('repository must be owner/name');
  if (repoPath != null && typeof repoPath !== 'string') throw new Error('repoPath must be a string when supplied');
  if (!objective) throw new Error('objective is required');
  if (!Array.isArray(testCommands)) throw new Error('testCommands must be an array');
  if (microSharding != null && typeof microSharding !== 'object') throw new Error('microSharding must be an object when supplied');
  const branchBase = `${branchPrefix}/${slug(key)}`;
  const requiredChecks = acceptance.requiredChecks ?? testCommands.map((entry, index) => entry.name ?? `test-${index + 1}`);
  const normalizedAcceptance = {
    requiredChecks,
    requireIndependentVerifier: riskClass === 'high' || riskClass === 'critical' || acceptance.requireIndependentVerifier === true,
    ...acceptance
  };
  const normalizedModelRequest = modelRequest ?? {
    capabilities: ['coding'],
    minContextWindow: 8192,
    maxCostPerMillionTokens: 0,
    taskClass: 'coding'
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
      stage: TaskStage.IMPLEMENTATION,
      priority,
      restartable: true,
      mutationScopes: [`repo:${repository}`, `branch-base:${repository}:${branchBase}`],
      acceptance: normalizedAcceptance,
      modelRequest: normalizedModelRequest,
      execution: {
        kind: 'coding-agent',
        ...(repoPath ? { repoPath } : {}),
        ref,
        baseBranch,
        branchBase,
        goal: objective,
        acceptance: normalizedAcceptance,
        testCommands,
        maxSteps: Math.max(1, Math.min(64, Number(maxSteps))),
        autoCommit: Boolean(autoCommit),
        autoPush: Boolean(autoPush),
        commitMessage: `maxxed: ${String(objective).slice(0, 120)}`,
        taskKey: key,
        ...(microSharding ? { microSharding: structuredClone(microSharding) } : {})
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
  const selectedModel = dispatch.modelSelection?.model ?? null;
  if (task.metadata?.modelRequest && !selectedModel?.endpoint) throw new Error('coding task requires a routed local model endpoint');
  const patchBundle = execution.patchBundle ? {
    ...structuredClone(execution.patchBundle),
    generation
  } : null;
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
      modelEndpoint: selectedModel?.endpoint ?? execution.modelEndpoint,
      model: selectedModel?.id ?? execution.model,
      publishAfterLeaseValidation: Boolean(execution.autoPush),
      autoPush: false,
      controlPlaneTaskKey: task.key,
      controlPlaneClaim: dispatch.claim,
      ...(patchBundle ? { patchBundle } : {})
    }
  };
}

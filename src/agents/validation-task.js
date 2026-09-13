const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_STEPS = 32;
const SAFE_ENV_KEYS = new Set(['CI', 'NODE_ENV', 'TZ', 'PYTHONUNBUFFERED', 'DOTNET_NOLOGO']);
const FORBIDDEN_ENV_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

function capabilityFor(command) {
  if (command === 'python3') return 'python';
  return command;
}

function validateEnvironment(env = {}, index) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new Error(`validation step ${index} env must be an object`);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') throw new Error(`validation step ${index} env value must be a string: ${key}`);
    if (FORBIDDEN_ENV_PATTERN.test(key)) throw new Error(`validation step ${index} env key is forbidden: ${key}`);
    if (!SAFE_ENV_KEYS.has(key) && !key.startsWith('MAXXED_VALIDATION_')) throw new Error(`validation step ${index} env key is not allowlisted: ${key}`);
  }
}

function validateStepPolicy(command, args, index) {
  if (command === 'npm') {
    if (args[0] === 'test') return;
    if (args[0] === 'run' && typeof args[1] === 'string' && /^[A-Za-z0-9:_.-]+$/.test(args[1])) return;
    throw new Error(`validation step ${index} npm is limited to test or run <script>`);
  }
  if (command === 'node') {
    if (args[0] === '--test') return;
    if (args[0] === '--check' && args[1] && !String(args[1]).startsWith('-')) return;
    if (args.length === 1 && args[0] && !args[0].startsWith('-')) return;
    throw new Error(`validation step ${index} node is limited to --test, --check <workspace-file>, or one workspace script`);
  }
  if (command === 'python' || command === 'python3') {
    if (args[0] === '-m' && ['pytest', 'unittest'].includes(args[1])) return;
    throw new Error(`validation step ${index} python is limited to -m pytest or -m unittest`);
  }
  if (command === 'git') {
    if (['status', 'diff', 'rev-parse', 'show'].includes(args[0])) return;
    throw new Error(`validation step ${index} git is read-only`);
  }
  if (command === 'dotnet') {
    if (['test', 'build'].includes(args[0])) return;
    throw new Error(`validation step ${index} dotnet is limited to test or build`);
  }
  if (command === 'java') {
    if (args[0] === '-version' && args.length === 1) return;
    throw new Error(`validation step ${index} java is limited to -version`);
  }
  if (command === 'npx') throw new Error(`validation step ${index} npx is disabled`);
  throw new Error(`validation step ${index} command is not allowed: ${command}`);
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
  const normalizedSteps = steps.map((step, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    if (!step?.command || typeof step.command !== 'string') throw new Error(`validation step ${index} command is required`);
    const args = step.args ?? [];
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error(`validation step ${index} args must be strings`);
    validateStepPolicy(step.command, args, index);
    validateEnvironment(step.env ?? {}, index);
    if (step.timeoutMs != null && (!Number.isFinite(Number(step.timeoutMs)) || Number(step.timeoutMs) < 1_000 || Number(step.timeoutMs) > 15 * 60_000)) throw new Error(`validation step ${index} timeoutMs must be between 1000 and 900000`);
    return {
      name: String(step.name ?? `step-${index}`),
      command: step.command,
      args: [...args],
      ...(step.timeoutMs != null ? { timeoutMs: Number(step.timeoutMs) } : {}),
      ...(step.env ? { env: structuredClone(step.env) } : {})
    };
  });
  const capabilities = [...new Set(['validation-agent', 'git', ...normalizedSteps.map((step) => capabilityFor(step.command)), ...(requirements.capabilities ?? [])])];
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

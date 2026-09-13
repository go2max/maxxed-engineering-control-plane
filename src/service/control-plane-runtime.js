import { TaskGraph } from '../core/task-graph.js';
import { ClaimAuthority } from '../core/claim-authority.js';
import { EngineeringOrchestrator } from '../core/orchestrator.js';
import { PortfolioScheduler } from '../scheduler/portfolio-scheduler.js';
import { SchedulerPolicy } from '../scheduler/scheduler-policy.js';
import { AcceptanceVerifier } from '../verification/verifier.js';
import { RepairController } from '../verification/repair-controller.js';
import { ModelRegistry } from '../models/model-registry.js';
import { ModelRouter } from '../models/model-router.js';
import { ModelEvalLedger } from '../models/model-evals.js';
import { ModelRuntimeGovernor, LocalModelExecutionPool } from '../models/model-runtime-governor.js';
import { LocalInferenceClient } from '../models/local-inference-client.js';
import { restoreRuntime, snapshotRuntime } from '../core/runtime-state.js';

export class ControlPlaneRuntime {
  constructor({ workerProvider = async () => [], schedulerOptions = {}, modelDefinitions = [], modelClientFactory = null } = {}) {
    this.graph = new TaskGraph();
    this.claims = new ClaimAuthority();
    this.repairs = new RepairController();
    this.verifier = new AcceptanceVerifier();
    this.policy = new SchedulerPolicy();
    this.modelRegistry = new ModelRegistry();
    this.modelEvals = new ModelEvalLedger();
    this.modelGovernor = new ModelRuntimeGovernor();
    this.modelClientFactory = modelClientFactory ?? ((model) => new LocalInferenceClient({ baseUrl: model.endpoint ?? 'http://127.0.0.1:8080' }));
    for (const model of modelDefinitions) {
      const registered = this.modelRegistry.register(model);
      if (registered.kind === 'local') this.modelGovernor.register(registered);
    }
    this.modelRouter = new ModelRouter({ registry: this.modelRegistry, evalLedger: this.modelEvals, allowExternalEscalation: false });
    this.modelPool = new LocalModelExecutionPool({ registry: this.modelRegistry, router: this.modelRouter, governor: this.modelGovernor, clientFactory: this.modelClientFactory });
    this.scheduler = new PortfolioScheduler({ graph: this.graph, policy: this.policy, ...schedulerOptions });
    this.orchestrator = new EngineeringOrchestrator({ graph: this.graph, scheduler: this.scheduler, claims: this.claims, verifier: this.verifier, repairs: this.repairs, modelRouter: this.modelRouter });
    this.workerProvider = workerProvider;
    this.paused = false;
  }

  ingest(task) { return this.graph.add(task); }
  upsert(task) { return this.graph.upsert(task); }

  async dispatch(now = Date.now()) {
    if (this.paused) return [];
    const workers = await this.workerProvider();
    return this.orchestrator.dispatch(workers, { now });
  }

  complete(payload) { return this.orchestrator.complete(payload); }
  recoverExpired(now = Date.now()) { return this.orchestrator.recoverExpired(now); }
  async warmupModels(now = Date.now()) { return this.modelGovernor.warmupAll(this.modelRegistry, this.modelClientFactory, now); }

  async executeModel({ request, messages, temperature = 0, maxTokens = 2048, now = Date.now() } = {}) {
    if (!request) throw new Error('model request is required');
    const started = Date.now();
    try {
      const result = await this.modelPool.execute(request, { messages, temperature, maxTokens }, { now });
      this.modelEvals.record({ modelId: result.model.id, taskClass: request.taskClass ?? 'standard', accepted: true, latencyMs: Date.now() - started });
      return result;
    } catch (error) {
      const attempted = error.attempts?.filter((item) => item.outcome === 'failure') ?? [];
      for (const attempt of attempted) {
        this.modelEvals.record({ modelId: attempt.modelId, taskClass: request.taskClass ?? 'standard', accepted: false, latencyMs: Date.now() - started, failureClass: 'INFERENCE_FAILURE' });
      }
      throw error;
    }
  }

  operatorCommand(command = {}) {
    const { action, input = {} } = command;
    switch (action) {
      case 'pause-dispatch': return this.pause();
      case 'resume-dispatch': return this.resume();
      case 'set-repository-lane-limit': {
        if (!input.repository || !Number.isInteger(input.limit) || input.limit < 0 || input.limit > 64) throw new Error('repository and integer limit 0..64 are required');
        this.scheduler.repoLaneLimits[input.repository] = input.limit;
        return this.status();
      }
      case 'freeze-repository': this.policy.freezeRepository(input.repository, input.reason); return this.status();
      case 'thaw-repository': this.policy.thawRepository(input.repository); return this.status();
      case 'drain-repository': this.policy.drainRepository(input.repository, input.reason); return this.status();
      case 'resume-repository': this.policy.resumeRepository(input.repository); return this.status();
      case 'set-priority-override': this.policy.setPriorityOverride(input); return this.status();
      case 'clear-priority-override': this.policy.clearPriorityOverride(input.taskKey); return this.status();
      case 'recover-expired': return { expired: this.recoverExpired() };
      default: throw new Error(`unsupported operator command: ${action}`);
    }
  }

  status() {
    const tasks = this.graph.list();
    const claims = this.claims.list();
    const stateCounts = Object.fromEntries([...new Set(tasks.map((task) => task.state))].sort().map((state) => [state, tasks.filter((task) => task.state === state).length]));
    const registeredModels = this.modelRegistry.list();
    return {
      paused: this.paused,
      tasks: { total: tasks.length, byState: stateCounts, executable: this.graph.frontier().length },
      claims: { active: claims.length },
      models: {
        registered: registeredModels.length,
        healthy: registeredModels.filter((model) => model.healthy && model.enabled).length,
        runtime: this.modelGovernor.list(),
        evals: this.modelEvals.list()
      },
      scheduler: { repositoryLaneLimits: { ...this.scheduler.repoLaneLimits }, policy: this.policy.status() }
    };
  }

  snapshot() {
    return {
      version: 3,
      core: snapshotRuntime({ graph: this.graph, claims: this.claims, repairs: this.repairs }),
      policy: this.policy.snapshot(),
      models: { governor: this.modelGovernor.snapshot(), evals: this.modelEvals.snapshot() },
      paused: this.paused,
      repositoryLaneLimits: { ...this.scheduler.repoLaneLimits }
    };
  }

  restore(snapshot, now = Date.now()) {
    if (snapshot?.version === 3) {
      const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now });
      this.policy.restore(snapshot.policy);
      this.modelGovernor.restore(snapshot.models?.governor, now);
      this.modelEvals.restore(snapshot.models?.evals);
      this.paused = Boolean(snapshot.paused);
      this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) };
      return restored;
    }
    if (snapshot?.version === 2) {
      const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now });
      this.policy.restore(snapshot.policy);
      this.paused = Boolean(snapshot.paused);
      this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) };
      return restored;
    }
    return restoreRuntime(snapshot, { graph: this.graph, claims: this.claims, repairs: this.repairs, now });
  }

  pause() { this.paused = true; return this.status(); }
  resume() { this.paused = false; return this.status(); }
}

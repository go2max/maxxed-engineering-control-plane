import { TaskGraph } from '../core/task-graph.js';
import { ClaimAuthority } from '../core/claim-authority.js';
import { EngineeringOrchestrator } from '../core/orchestrator.js';
import { PortfolioScheduler } from '../scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../verification/verifier.js';
import { RepairController } from '../verification/repair-controller.js';
import { ModelRegistry } from '../models/model-registry.js';
import { ModelRouter } from '../models/model-router.js';
import { ModelEvalLedger } from '../models/model-evals.js';
import { restoreRuntime, snapshotRuntime } from '../core/runtime-state.js';

export class ControlPlaneRuntime {
  constructor({ workerProvider = async () => [], schedulerOptions = {}, modelDefinitions = [] } = {}) {
    this.graph = new TaskGraph();
    this.claims = new ClaimAuthority();
    this.repairs = new RepairController();
    this.verifier = new AcceptanceVerifier();
    this.modelRegistry = new ModelRegistry();
    this.modelEvals = new ModelEvalLedger();
    for (const model of modelDefinitions) this.modelRegistry.register(model);
    this.modelRouter = new ModelRouter({ registry: this.modelRegistry, evalLedger: this.modelEvals, allowExternalEscalation: false });
    this.scheduler = new PortfolioScheduler({ graph: this.graph, ...schedulerOptions });
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

  status() {
    const tasks = this.graph.list();
    const claims = this.claims.list();
    const stateCounts = Object.fromEntries([...new Set(tasks.map((task) => task.state))].sort().map((state) => [state, tasks.filter((task) => task.state === state).length]));
    return {
      paused: this.paused,
      tasks: { total: tasks.length, byState: stateCounts, executable: this.graph.frontier().length },
      claims: { active: claims.length },
      models: { registered: this.modelRegistry.list().length, healthy: this.modelRegistry.list().filter((model) => model.healthy && model.enabled).length }
    };
  }

  snapshot() { return snapshotRuntime({ graph: this.graph, claims: this.claims, repairs: this.repairs }); }
  restore(snapshot, now = Date.now()) { return restoreRuntime(snapshot, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); }
  pause() { this.paused = true; return this.status(); }
  resume() { this.paused = false; return this.status(); }
}

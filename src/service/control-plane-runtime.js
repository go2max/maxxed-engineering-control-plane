import { TaskGraph, TaskState } from '../core/task-graph.js';
import { ClaimAuthority } from '../core/claim-authority.js';
import { EngineeringOrchestrator } from '../core/orchestrator.js';
import { EventJournal } from '../core/event-journal.js';
import { PortfolioScheduler } from '../scheduler/portfolio-scheduler.js';
import { SchedulerPolicy } from '../scheduler/scheduler-policy.js';
import { ThroughputGovernor } from '../scheduler/throughput-governor.js';
import { AcceptanceVerifier, FailureClass } from '../verification/verifier.js';
import { RepairController } from '../verification/repair-controller.js';
import { VerificationLedger } from '../verification/verification-ledger.js';
import { ModelRegistry } from '../models/model-registry.js';
import { ModelRouter } from '../models/model-router.js';
import { ModelEvalLedger } from '../models/model-evals.js';
import { ModelRuntimeGovernor, LocalModelExecutionPool } from '../models/model-runtime-governor.js';
import { ModelFabricDiscovery } from '../models/model-fabric-discovery.js';
import { LocalInferenceClient } from '../models/local-inference-client.js';
import { restoreRuntime, snapshotRuntime } from '../core/runtime-state.js';
import { fabricTaskFromDispatch } from '../agents/coding-task.js';
import { evidenceFromFabricResult } from './fabric-execution-client.js';

const isCodingTask = (task) => task?.metadata?.execution?.kind === 'coding-agent';

export class ControlPlaneRuntime {
  constructor({ workerProvider = async () => [], schedulerOptions = {}, modelDefinitions = [], modelClientFactory = null, fabricExecutionClient = null, throughputOptions = {} } = {}) {
    this.graph = new TaskGraph(); this.claims = new ClaimAuthority(); this.repairs = new RepairController(); this.verifier = new AcceptanceVerifier();
    this.verificationLedger = new VerificationLedger(); this.policy = new SchedulerPolicy(); this.journal = new EventJournal();
    this.modelRegistry = new ModelRegistry(); this.modelEvals = new ModelEvalLedger(); this.modelGovernor = new ModelRuntimeGovernor();
    this.modelClientFactory = modelClientFactory ?? ((model) => new LocalInferenceClient({ baseUrl: model.endpoint ?? 'http://127.0.0.1:8080' }));
    for (const model of modelDefinitions) { const registered = this.modelRegistry.register(model); if (registered.kind === 'local') this.modelGovernor.register(registered); }
    this.modelRouter = new ModelRouter({ registry: this.modelRegistry, evalLedger: this.modelEvals, allowExternalEscalation: false });
    this.modelPool = new LocalModelExecutionPool({ registry: this.modelRegistry, router: this.modelRouter, governor: this.modelGovernor, clientFactory: this.modelClientFactory });
    this.modelDiscovery = new ModelFabricDiscovery({ registry: this.modelRegistry, governor: this.modelGovernor });
    this.scheduler = new PortfolioScheduler({ graph: this.graph, policy: this.policy, ...schedulerOptions });
    this.orchestrator = new EngineeringOrchestrator({ graph: this.graph, scheduler: this.scheduler, claims: this.claims, verifier: this.verifier, repairs: this.repairs, modelRouter: this.modelRouter, verificationLedger: this.verificationLedger });
    this.workerProvider = workerProvider; this.fabricExecutionClient = fabricExecutionClient; this.throughput = new ThroughputGovernor(throughputOptions);
    this.paused = false; this.restoredAt = null; this.lastModelDiscovery = null; this.lastThroughputDecision = null;
  }

  ingest(task, { idempotencyKey = null, now = Date.now() } = {}) { return this.journal.once(idempotencyKey, task, () => { const result = this.graph.add(task); this.journal.append('task.ingested', { taskKey: result.key }, now); return result; }); }
  upsert(task, { idempotencyKey = null, now = Date.now() } = {}) { return this.journal.once(idempotencyKey, task, () => { const result = this.graph.upsert(task); this.journal.append('task.upserted', { taskKey: result.key }, now); return result; }); }

  reconcileModels(workers, now = Date.now()) {
    const result = this.modelDiscovery.reconcile(workers);
    this.lastModelDiscovery = { at: now, ...result };
    if (result.discovered.length || result.disabled.length) this.journal.append('models.fabric.reconciled', result, now);
    return result;
  }

  async dispatch(now = Date.now(), { taskPredicate = () => true } = {}) {
    if (this.paused) return [];
    const workers = await this.workerProvider();
    this.reconcileModels(workers, now);
    const verificationRows = this.verificationLedger.entries ?? [];
    const recent = verificationRows.slice(-50);
    const recentAccepted = recent.filter((entry) => entry.action === 'ACCEPT').length;
    const recentFailed = recent.filter((entry) => ['TERMINATE', 'ESCALATE'].includes(entry.action)).length;
    const verifierBacklog = this.graph.list().filter((task) => task.state === TaskState.BLOCKED && task.lineage?.at(-1)?.evidence?.reason === 'repair-task-created').length;
    const availableCapacity = workers.reduce((sum, worker) => sum + Math.max(0, worker.capacity?.freeSlots ?? 0), 0);
    this.lastThroughputDecision = this.throughput.target({ availableCapacity, verifierBacklog, recentAccepted, recentFailed, degraded: !this.readiness().ready });
    const previousLimit = this.scheduler.totalLaneLimit;
    this.scheduler.totalLaneLimit = Math.max(1, this.lastThroughputDecision.allowedConcurrency || 1);
    try {
      const dispatches = this.orchestrator.dispatch(workers, { now, taskPredicate });
      if (dispatches.length) this.journal.append('dispatch.issued', { tasks: dispatches.map((entry) => entry.taskKey), workers: dispatches.map((entry) => entry.workerId), throughput: this.lastThroughputDecision }, now);
      return dispatches;
    } finally {
      this.scheduler.totalLaneLimit = previousLimit;
    }
  }

  async dispatchToFabric(now = Date.now()) {
    if (!this.fabricExecutionClient) throw new Error('fabric execution client is not configured');
    const dispatches = await this.dispatch(now, { taskPredicate: isCodingTask });
    const submitted = [];
    for (const dispatch of dispatches) {
      const task = this.graph.get(dispatch.taskKey);
      try {
        const fabricTask = fabricTaskFromDispatch(task, dispatch);
        const accepted = await this.fabricExecutionClient.enqueue(fabricTask);
        submitted.push({ taskKey: task.key, workerId: dispatch.workerId, fabricTask: accepted });
        this.journal.append('fabric.task.submitted', { taskKey: task.key, fabricTaskId: accepted.taskId, workerId: dispatch.workerId }, now);
      } catch (error) {
        this.claims.release(dispatch.claim);
        this.graph.setState(task.key, TaskState.READY, { reason: 'fabric submission failed', error: error.message });
        this.journal.append('fabric.task.submit-failed', { taskKey: task.key, error: error.message }, now);
      }
    }
    return submitted;
  }

  async reconcileFabric(now = Date.now()) {
    if (!this.fabricExecutionClient) throw new Error('fabric execution client is not configured');
    const fleet = await this.fabricExecutionClient.fleet();
    const reconciled = [];
    for (const fabricTask of fleet.tasks ?? []) {
      if (!['SUCCEEDED', 'FAILED', 'RECONCILE'].includes(fabricTask.state)) continue;
      const taskKey = fabricTask.payload?.controlPlaneTaskKey;
      if (!taskKey) continue;
      const task = this.graph.get(taskKey);
      if (!task || task.state !== TaskState.CLAIMED) continue;
      const claim = fabricTask.payload?.controlPlaneClaim;
      if (!claim || !this.claims.validate(claim, now)) continue;

      if (fabricTask.state === 'RECONCILE') {
        this.claims.release(claim);
        this.graph.setState(taskKey, TaskState.BLOCKED, { reason: 'fabric requires reconciliation', fabricTaskId: fabricTask.taskId, failure: fabricTask.failure });
        reconciled.push({ taskKey, action: 'RECONCILE' });
        continue;
      }

      let evidence;
      if (fabricTask.state === 'SUCCEEDED') evidence = evidenceFromFabricResult(task, fabricTask);
      else {
        const required = task.metadata?.acceptance?.requiredChecks ?? ['execution'];
        evidence = {
          producerId: fabricTask.preferredWorkerId ?? 'fabric-worker', verifierId: null,
          checks: Object.fromEntries(required.map((name) => [name, { ok: false, class: FailureClass.BUILD_FAILURE, detail: fabricTask.failure?.error ?? fabricTask.failure ?? 'worker execution failed' }])),
          artifacts: {}, execution: []
        };
      }
      const result = this.complete({ taskKey, claim, acceptance: task.metadata?.acceptance ?? {}, evidence }, { idempotencyKey: `fabric-result:${fabricTask.taskId}:${fabricTask.updatedAt}`, now });
      reconciled.push({ taskKey, action: result.decision?.action ?? null, fabricTaskId: fabricTask.taskId, branchName: evidence.artifacts?.branchName ?? null, commitSha: evidence.artifacts?.commitSha ?? null });
    }
    if (reconciled.length) this.journal.append('fabric.results.reconciled', { results: reconciled }, now);
    return reconciled;
  }

  complete(payload, { idempotencyKey = null, now = Date.now() } = {}) { return this.journal.once(idempotencyKey, payload, () => { const result = this.orchestrator.complete({ ...payload, now }); this.journal.append('task.completed', { taskKey: payload.taskKey, verdict: result.verification?.verdict ?? null, action: result.decision?.action ?? null }, now); return result; }); }
  resolveVerificationGate(payload, now = Date.now()) { const result = this.orchestrator.resolveVerificationGate({ ...payload, now }); this.journal.append('verification.gate.resolved', { taskKey: payload.taskKey, repairTaskKey: payload.repairTaskKey ?? null, reconciliation: Boolean(payload.reconciliationEvidence) }, now); return result; }
  recoverExpired(now = Date.now()) { const expired = this.orchestrator.recoverExpired(now); if (expired.length) this.journal.append('claims.recovered', { claimIds: expired.map((entry) => entry.claimId), taskKeys: expired.map((entry) => entry.taskKey) }, now); return expired; }
  async warmupModels(now = Date.now()) { const results = await this.modelGovernor.warmupAll(this.modelRegistry, this.modelClientFactory, now); this.journal.append('models.warmup', { results: results.map(({ modelId, healthy }) => ({ modelId, healthy })) }, now); return results; }

  async executeModel({ request, messages, temperature = 0, maxTokens = 2048, now = Date.now() } = {}) {
    if (!request) throw new Error('model request is required');
    const workers = await this.workerProvider();
    this.reconcileModels(workers, now);
    const started = Date.now();
    try {
      const result = await this.modelPool.execute(request, { messages, temperature, maxTokens }, { now });
      this.modelEvals.record({ modelId: result.model.id, taskClass: request.taskClass ?? 'standard', accepted: true, latencyMs: Date.now() - started });
      this.journal.append('model.inference.succeeded', { modelId: result.model.id, workerId: result.model.metadata?.workerId ?? null, taskClass: request.taskClass ?? 'standard', budget: result.budget }, now);
      return result;
    } catch (error) {
      const attempted = error.attempts?.filter((item) => item.outcome === 'failure') ?? [];
      for (const attempt of attempted) this.modelEvals.record({ modelId: attempt.modelId, taskClass: request.taskClass ?? 'standard', accepted: false, latencyMs: Date.now() - started, failureClass: 'INFERENCE_FAILURE' });
      this.journal.append('model.inference.failed', { taskClass: request.taskClass ?? 'standard', attempts: error.attempts ?? [] }, now); throw error;
    }
  }

  operatorCommand(command = {}, { commandId = null, now = Date.now() } = {}) {
    const { action, input = {} } = command;
    const effectiveCommandId = commandId ?? command.commandId ?? null;
    const request = { action, input };
    return this.journal.once(effectiveCommandId, request, () => {
      let result;
      switch (action) {
        case 'pause-dispatch': result = this.pause(); break; case 'resume-dispatch': result = this.resume(); break;
        case 'set-repository-lane-limit': if (!input.repository || !Number.isInteger(input.limit) || input.limit < 0 || input.limit > 64) throw new Error('repository and integer limit 0..64 are required'); this.scheduler.repoLaneLimits[input.repository] = input.limit; result = this.status(); break;
        case 'freeze-repository': this.policy.freezeRepository(input.repository, input.reason); result = this.status(); break; case 'thaw-repository': this.policy.thawRepository(input.repository); result = this.status(); break;
        case 'drain-repository': this.policy.drainRepository(input.repository, input.reason); result = this.status(); break; case 'resume-repository': this.policy.resumeRepository(input.repository); result = this.status(); break;
        case 'set-priority-override': this.policy.setPriorityOverride(input); result = this.status(); break; case 'clear-priority-override': this.policy.clearPriorityOverride(input.taskKey); result = this.status(); break;
        case 'recover-expired': result = { expired: this.recoverExpired(now) }; break; case 'resolve-verification-gate': result = this.resolveVerificationGate(input, now); break;
        default: throw new Error(`unsupported operator command: ${action}`);
      }
      this.journal.append('operator.command', { commandId: effectiveCommandId, action, input }, now);
      return result;
    });
  }

  readiness() {
    const models = this.modelRegistry.list();
    const unhealthyRequiredModels = models.filter((model) => model.enabled && model.kind === 'local' && model.metadata?.required === true && !model.healthy).map((model) => model.id);
    const ready = unhealthyRequiredModels.length === 0;
    return { ready, state: ready ? (this.paused ? 'PAUSED' : 'READY') : 'DEGRADED', paused: this.paused, unhealthyRequiredModels, restoredAt: this.restoredAt, journalSequence: this.journal.sequence };
  }

  status() {
    const tasks = this.graph.list(); const claims = this.claims.list(); const stateCounts = Object.fromEntries([...new Set(tasks.map((task) => task.state))].sort().map((state) => [state, tasks.filter((task) => task.state === state).length])); const registeredModels = this.modelRegistry.list();
    return { paused: this.paused, readiness: this.readiness(), tasks: { total: tasks.length, byState: stateCounts, executable: this.graph.frontier().length }, claims: { active: claims.length }, verification: { records: this.verificationLedger.entries.length, sequence: this.verificationLedger.sequence }, models: { registered: registeredModels.length, healthy: registeredModels.filter((model) => model.healthy && model.enabled).length, runtime: this.modelGovernor.list(), evals: this.modelEvals.list(), fabricDiscovery: this.lastModelDiscovery }, scheduler: { repositoryLaneLimits: { ...this.scheduler.repoLaneLimits }, policy: this.policy.status(), throughput: this.lastThroughputDecision } };
  }

  snapshot() { return { version: 6, core: snapshotRuntime({ graph: this.graph, claims: this.claims, repairs: this.repairs }), policy: this.policy.snapshot(), journal: this.journal.snapshot(), verification: this.verificationLedger.snapshot(), models: { governor: this.modelGovernor.snapshot(), evals: this.modelEvals.snapshot(), lastDiscovery: this.lastModelDiscovery }, paused: this.paused, repositoryLaneLimits: { ...this.scheduler.repoLaneLimits } }; }

  restore(snapshot, now = Date.now()) {
    if (snapshot?.version === 6) {
      const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.policy.restore(snapshot.policy); this.journal.restore(snapshot.journal); this.verificationLedger.restore(snapshot.verification); this.modelGovernor.restore(snapshot.models?.governor, now); this.modelEvals.restore(snapshot.models?.evals); this.lastModelDiscovery = snapshot.models?.lastDiscovery ?? null; this.paused = Boolean(snapshot.paused); this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) }; this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 6 }, now); return restored;
    }
    if (snapshot?.version === 5) { const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.policy.restore(snapshot.policy); this.journal.restore(snapshot.journal); this.verificationLedger.restore(snapshot.verification); this.modelGovernor.restore(snapshot.models?.governor, now); this.modelEvals.restore(snapshot.models?.evals); this.paused = Boolean(snapshot.paused); this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) }; this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 5 }, now); return restored; }
    if (snapshot?.version === 4) { const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.policy.restore(snapshot.policy); this.journal.restore(snapshot.journal); this.modelGovernor.restore(snapshot.models?.governor, now); this.modelEvals.restore(snapshot.models?.evals); this.paused = Boolean(snapshot.paused); this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) }; this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 4 }, now); return restored; }
    if (snapshot?.version === 3) { const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.policy.restore(snapshot.policy); this.modelGovernor.restore(snapshot.models?.governor, now); this.modelEvals.restore(snapshot.models?.evals); this.paused = Boolean(snapshot.paused); this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) }; this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 3 }, now); return restored; }
    if (snapshot?.version === 2) { const restored = restoreRuntime(snapshot.core, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.policy.restore(snapshot.policy); this.paused = Boolean(snapshot.paused); this.scheduler.repoLaneLimits = { ...(snapshot.repositoryLaneLimits ?? {}) }; this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 2 }, now); return restored; }
    const restored = restoreRuntime(snapshot, { graph: this.graph, claims: this.claims, repairs: this.repairs, now }); this.restoredAt = now; this.journal.append('runtime.restored', { snapshotVersion: 1 }, now); return restored;
  }

  pause() { this.paused = true; return this.status(); }
  resume() { this.paused = false; return this.status(); }
}

import { TaskState } from '../core/task-graph.js';
import { fabricTaskFromDispatch } from '../agents/coding-task.js';

const isCodingTask = (task) => task?.metadata?.execution?.kind === 'coding-agent';

function acceptedBundle(task) {
  return [...(task?.lineage ?? [])].reverse().find((entry) => entry.state === TaskState.ACCEPTED && entry.evidence?.evidenceBundle)?.evidence?.evidenceBundle ?? null;
}

function workerIdFromBundle(bundle) {
  return bundle?.payload?.evidence?.producerId ?? bundle?.payload?.producerId ?? null;
}

function durationFromBundle(bundle) {
  const value = bundle?.payload?.evidence?.artifacts?.durationMs ?? bundle?.payload?.evidence?.durationMs ?? null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export class AutonomousCodingLoop {
  constructor({ runtime, fabricClient, promotion = null, leverage = null, workerPerformance = null, microShards = null, intervalMs = 2_000, now = () => Date.now() } = {}) {
    if (!runtime || !fabricClient) throw new Error('runtime and fabricClient are required');
    this.runtime = runtime; this.fabric = fabricClient; this.promotion = promotion; this.leverage = leverage; this.workerPerformance = workerPerformance; this.microShards = microShards; this.intervalMs = Math.max(500, Number(intervalMs)); this.now = now;
    this.timer = null; this.running = false; this.lastTick = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((error) => {
      this.runtime.journal.append('coding.loop.error', { error: error.message }, this.now());
    }), this.intervalMs);
    this.timer.unref?.();
    void this.tick().catch((error) => this.runtime.journal.append('coding.loop.error', { error: error.message }, this.now()));
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  #recordWorkerOutcome(task, bundle, accepted, failureClass = null, now = Date.now()) {
    const workerId = workerIdFromBundle(bundle);
    if (!this.workerPerformance || !workerId || !task) return null;
    const language = task.requirements?.language ?? task.metadata?.language ?? 'any';
    return this.workerPerformance.record({ workerId, taskClass: task.taskClass ?? 'coding', language, accepted, durationMs: durationFromBundle(bundle), failureClass, now });
  }

  #harvest(reconciled, now) {
    const harvested = [];
    for (const row of reconciled) {
      const task = this.runtime.graph.get(row.taskKey);
      if (task) {
        if (row.action === 'ACCEPT') {
          const bundle = acceptedBundle(task);
          if (bundle) {
            if (this.leverage) harvested.push(this.leverage.recordAccepted(task, bundle, { now }));
            this.#recordWorkerOutcome(task, bundle, true, null, now);
          }
        } else if (row.action) {
          if (this.leverage) harvested.push(this.leverage.recordOutcome(task, row.action, { fabricTaskId: row.fabricTaskId ?? null, branchName: row.branchName ?? null, commitSha: row.commitSha ?? null }));
          const bundle = acceptedBundle(task);
          this.#recordWorkerOutcome(task, bundle, false, row.action, now);
        }
      }
      if (row.parentTaskKey && row.parentState === TaskState.ACCEPTED) {
        const parent = this.runtime.graph.get(row.parentTaskKey); const bundle = acceptedBundle(parent);
        if (parent && bundle && this.leverage) harvested.push(this.leverage.recordAccepted(parent, bundle, { now }));
      }
    }
    return harvested.filter(Boolean);
  }

  #harvestPatchParents(patchResult, now) {
    const rows = [];
    for (const accepted of patchResult?.acceptedParents ?? []) {
      if (this.leverage) rows.push(this.leverage.recordAccepted(accepted.task, accepted.evidenceBundle, { now }));
      this.#recordWorkerOutcome(accepted.task, accepted.evidenceBundle, true, null, now);
    }
    return rows.filter(Boolean);
  }

  async tick() {
    if (this.running || this.runtime.paused) return this.lastTick;
    this.running = true;
    const now = this.now();
    try {
      this.runtime.recoverExpired(now);
      const reconciled = await this.runtime.reconcileFabric(now);
      const patchReconciliation = this.microShards ? this.microShards.reconcile(reconciled, { now }) : { submitted: [], composed: [], acceptedParents: [], failedParents: [] };
      const harvested = [...this.#harvest(reconciled, now), ...this.#harvestPatchParents(patchReconciliation, now)];
      const promoted = this.promotion ? await this.promotion.sync(now) : [];
      const workers = await this.runtime.workerProvider();
      this.runtime.reconcileModels(workers, now);

      const verificationRows = this.runtime.verificationLedger.entries ?? [];
      const recent = verificationRows.slice(-50);
      const recentAccepted = recent.filter((entry) => entry.action === 'ACCEPT').length;
      const recentFailed = recent.filter((entry) => ['TERMINATE', 'ESCALATE'].includes(entry.action)).length;
      const verifierBacklog = this.runtime.graph.list().filter((task) => task.state === TaskState.BLOCKED).length;
      const availableCapacity = workers.reduce((sum, worker) => sum + Math.max(0, worker.capacity?.freeSlots ?? 0), 0);
      const throughput = this.runtime.throughput.target({ availableCapacity, verifierBacklog, recentAccepted, recentFailed, degraded: !this.runtime.readiness().ready });
      this.runtime.lastThroughputDecision = throughput;

      const materializedShards = this.microShards ? this.microShards.materialize({
        workers,
        verifierSlots: Math.max(1, Math.floor(Math.max(1, throughput.allowedConcurrency ?? 1) / 2)),
        composerSlots: 1,
        now
      }) : [];

      const previousLimit = this.runtime.scheduler.totalLaneLimit;
      let dispatches;
      this.runtime.scheduler.totalLaneLimit = Math.max(1, throughput.allowedConcurrency || 1);
      try { dispatches = this.runtime.orchestrator.dispatch(workers, { now, taskPredicate: isCodingTask }); }
      finally { this.runtime.scheduler.totalLaneLimit = previousLimit; }

      const submitted = [];
      for (const dispatch of dispatches) {
        const task = this.runtime.graph.get(dispatch.taskKey);
        try {
          const accepted = await this.fabric.enqueue(fabricTaskFromDispatch(task, dispatch));
          submitted.push({ taskKey: task.key, workerId: dispatch.workerId, fabricTaskId: accepted.taskId });
          this.runtime.journal.append('coding.task.submitted', { taskKey: task.key, workerId: dispatch.workerId, fabricTaskId: accepted.taskId }, now);
        } catch (error) {
          this.runtime.claims.release(dispatch.claim);
          this.runtime.graph.setState(task.key, TaskState.READY, { reason: 'fabric submission failed', error: error.message });
          this.runtime.journal.append('coding.task.submit-failed', { taskKey: task.key, error: error.message }, now);
        }
      }
      this.lastTick = { at: now, reconciled, harvested, promoted, submitted, throughput, patch: { reconciliation: patchReconciliation, materialized: materializedShards } };
      return structuredClone(this.lastTick);
    } finally { this.running = false; }
  }
}

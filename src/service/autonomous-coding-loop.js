import { TaskState } from '../core/task-graph.js';
import { fabricTaskFromDispatch } from '../agents/coding-task.js';

const isCodingTask = (task) => task?.metadata?.execution?.kind === 'coding-agent';

export class AutonomousCodingLoop {
  constructor({ runtime, fabricClient, promotion = null, intervalMs = 2_000, now = () => Date.now() } = {}) {
    if (!runtime || !fabricClient) throw new Error('runtime and fabricClient are required');
    this.runtime = runtime; this.fabric = fabricClient; this.promotion = promotion; this.intervalMs = Math.max(500, Number(intervalMs)); this.now = now;
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

  async tick() {
    if (this.running || this.runtime.paused) return this.lastTick;
    this.running = true;
    const now = this.now();
    try {
      this.runtime.recoverExpired(now);
      const reconciled = await this.runtime.reconcileFabric(now);
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

      const previousLimit = this.runtime.scheduler.totalLaneLimit;
      this.runtime.scheduler.totalLaneLimit = Math.max(1, throughput.allowedConcurrency || 1);
      const dispatches = this.runtime.orchestrator.dispatch(workers, { now, taskPredicate: isCodingTask });
      this.runtime.scheduler.totalLaneLimit = previousLimit;

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
      this.lastTick = { at: now, reconciled, promoted, submitted, throughput };
      return structuredClone(this.lastTick);
    } finally { this.running = false; }
  }
}

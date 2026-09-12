import { TaskState } from './task-graph.js';
import { RepairAction } from '../verification/repair-controller.js';

export class EngineeringOrchestrator {
  constructor({ graph, scheduler, claims, verifier, repairs, modelRouter } = {}) {
    if (!graph || !scheduler || !claims || !verifier || !repairs) throw new Error('graph, scheduler, claims, verifier and repairs are required');
    this.graph = graph;
    this.scheduler = scheduler;
    this.claims = claims;
    this.verifier = verifier;
    this.repairs = repairs;
    this.modelRouter = modelRouter ?? null;
  }

  dispatch(workers, { now = Date.now() } = {}) {
    this.claims.sweepExpired(now);
    const activeClaims = this.claims.list().map((claim) => ({
      taskKey: claim.taskKey,
      repository: this.graph.get(claim.taskKey)?.repository ?? null,
      workerId: claim.ownerId
    }));
    const proposed = this.scheduler.plan(workers, { now, activeClaims });
    const accepted = [];
    for (const dispatch of proposed) {
      const task = this.graph.get(dispatch.taskKey);
      if (!task || !this.graph.isExecutable(task.key)) continue;
      const scopes = this.#scopesFor(task);
      const claim = this.claims.claim({ taskKey: task.key, ownerId: dispatch.workerId, scopes }, now);
      if (!claim) continue;
      const modelSelection = this.modelRouter && task.metadata?.modelRequest
        ? this.modelRouter.route(task.metadata.modelRequest)
        : null;
      if (task.metadata?.modelRequest && !modelSelection?.model) {
        this.claims.release(claim);
        this.graph.setState(task.key, TaskState.BLOCKED, { reason: 'no eligible model' });
        continue;
      }
      this.graph.setState(task.key, TaskState.CLAIMED, { workerId: dispatch.workerId, claimId: claim.claimId });
      accepted.push({ ...dispatch, claim, modelSelection });
    }
    return accepted;
  }

  complete({ taskKey, claim, acceptance, evidence, now = Date.now() } = {}) {
    if (!this.claims.validate(claim, now)) throw new Error('stale or invalid claim');
    if (claim.taskKey !== taskKey) throw new Error('claim task mismatch');
    const verification = this.verifier.verify({ acceptance, evidence });
    const decision = this.repairs.decide(taskKey, verification);

    if (decision.action === RepairAction.ACCEPT) {
      this.graph.setState(taskKey, TaskState.ACCEPTED, { verification, evidence });
      this.claims.release(claim);
    } else if (decision.action === RepairAction.RETRY_REPAIR) {
      this.graph.setState(taskKey, TaskState.READY, { verification, repair: decision });
      this.claims.release(claim);
    } else if (decision.action === RepairAction.ESCALATE) {
      this.graph.setState(taskKey, TaskState.BLOCKED, { verification, escalation: decision });
      this.claims.release(claim);
    } else {
      this.graph.setState(taskKey, TaskState.FAILED, { verification, termination: decision });
      this.claims.release(claim);
    }
    return { verification, decision, task: this.graph.get(taskKey) };
  }

  recoverExpired(now = Date.now()) {
    const expired = this.claims.sweepExpired(now);
    for (const claim of expired) {
      const task = this.graph.get(claim.taskKey);
      if (!task || task.state !== TaskState.CLAIMED) continue;
      const unsafe = task.metadata?.restartable === false;
      this.graph.setState(task.key, unsafe ? TaskState.BLOCKED : TaskState.READY, {
        reason: unsafe ? 'claim expired during non-restartable work' : 'claim expired; task returned to frontier',
        expiredClaim: claim.claimId
      });
    }
    return expired;
  }

  #scopesFor(task) {
    const explicit = task.metadata?.mutationScopes ?? [];
    const repositoryScope = task.repository ? [`repo:${task.repository}`] : [];
    return [...new Set([...repositoryScope, ...explicit])];
  }
}

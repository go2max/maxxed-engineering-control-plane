import { TaskState } from './task-graph.js';
import { RepairAction } from '../verification/repair-controller.js';
import { buildEvidenceBundle, buildReconciliationRequirement, synthesizeRepairTask } from '../verification/evidence-bundle.js';

export class EngineeringOrchestrator {
  constructor({ graph, scheduler, claims, verifier, repairs, modelRouter, verificationLedger = null } = {}) {
    if (!graph || !scheduler || !claims || !verifier || !repairs) throw new Error('graph, scheduler, claims, verifier and repairs are required');
    this.graph = graph;
    this.scheduler = scheduler;
    this.claims = claims;
    this.verifier = verifier;
    this.repairs = repairs;
    this.modelRouter = modelRouter ?? null;
    this.verificationLedger = verificationLedger;
  }

  dispatch(workers, { now = Date.now(), taskPredicate = () => true } = {}) {
    this.claims.sweepExpired(now);
    const activeClaims = this.claims.list().map((claim) => ({
      taskKey: claim.taskKey,
      repository: this.graph.get(claim.taskKey)?.repository ?? null,
      workerId: claim.ownerId
    }));
    const proposed = this.scheduler.plan(workers, { now, activeClaims, taskPredicate });
    const accepted = [];
    for (const dispatch of proposed) {
      const task = this.graph.get(dispatch.taskKey);
      if (!task || !taskPredicate(task) || !this.graph.isExecutable(task.key)) continue;
      const scopes = this.#scopesFor(task);
      const claim = this.claims.claim({ taskKey: task.key, ownerId: dispatch.workerId, scopes }, now);
      if (!claim) continue;
      const modelSelection = this.modelRouter && task.metadata?.modelRequest ? this.modelRouter.route(task.metadata.modelRequest) : null;
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
    const task = this.graph.get(taskKey);
    const verification = this.verifier.verify({ acceptance, evidence });
    const bundle = buildEvidenceBundle({ taskKey, acceptance, evidence, verification, producerId: evidence?.producerId ?? claim.ownerId, verifierId: evidence?.verifierId ?? null, now });
    const decision = this.repairs.decide(taskKey, verification);
    let repairTask = null;
    let reconciliation = null;

    if (decision.action === RepairAction.ACCEPT) {
      this.graph.setState(taskKey, TaskState.ACCEPTED, { verification, evidenceBundle: bundle });
      this.#record({ taskKey, kind: 'acceptance', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest }, now);
      this.claims.release(claim);
    } else if (decision.action === RepairAction.RETRY_REPAIR) {
      const attempt = Number(decision.history?.attempts ?? 1);
      repairTask = synthesizeRepairTask({ task, verification, attempt });
      if (!this.graph.get(repairTask.key)) this.graph.add(repairTask);
      this.graph.setState(taskKey, TaskState.BLOCKED, { reason: 'repair-task-created', verification, repair: decision, repairTaskKey: repairTask.key, evidenceBundle: bundle });
      this.#record({ taskKey, kind: 'repair-required', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest, relatedTaskKey: repairTask.key }, now);
      this.claims.release(claim);
    } else if (decision.action === RepairAction.ESCALATE) {
      reconciliation = buildReconciliationRequirement({ taskKey, verification, evidenceBundle: bundle });
      this.graph.setState(taskKey, TaskState.BLOCKED, { verification, escalation: decision, reconciliation, evidenceBundle: bundle });
      this.#record({ taskKey, kind: reconciliation ? 'reconciliation-required' : 'escalation', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest, metadata: { reconciliation } }, now);
      this.claims.release(claim);
    } else {
      this.graph.setState(taskKey, TaskState.FAILED, { verification, termination: decision, evidenceBundle: bundle });
      this.#record({ taskKey, kind: 'terminal-failure', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest }, now);
      this.claims.release(claim);
    }
    return { verification, decision, evidenceBundle: bundle, repairTask, reconciliation, task: this.graph.get(taskKey) };
  }

  resolveVerificationGate({ taskKey, repairTaskKey = null, reconciliationEvidence = null, now = Date.now() } = {}) {
    const task = this.graph.get(taskKey);
    if (!task) throw new Error(`unknown task: ${taskKey}`);
    if (task.state !== TaskState.BLOCKED) throw new Error('verification gate may only resolve a blocked task');

    if (repairTaskKey) {
      const repair = this.graph.get(repairTaskKey);
      if (!repair || repair.metadata?.repairOf !== taskKey) throw new Error('repair task does not belong to blocked task');
      if (repair.state !== TaskState.ACCEPTED) throw new Error('repair task must be accepted before parent may resume');
      this.graph.setState(taskKey, TaskState.READY, { reason: 'accepted repair completed', repairTaskKey });
      this.#record({ taskKey, kind: 'repair-gate-resolved', action: 'READY', relatedTaskKey: repairTaskKey }, now);
      return this.graph.get(taskKey);
    }

    if (reconciliationEvidence) {
      if (reconciliationEvidence.authoritativeStateKnown !== true) throw new Error('authoritative external state must be known');
      if (!reconciliationEvidence.observedStateDigest) throw new Error('observedStateDigest is required');
      this.graph.setState(taskKey, TaskState.READY, { reason: 'external state reconciled', reconciliationEvidence: structuredClone(reconciliationEvidence) });
      this.#record({ taskKey, kind: 'reconciliation-resolved', action: 'READY', metadata: reconciliationEvidence }, now);
      return this.graph.get(taskKey);
    }

    throw new Error('repairTaskKey or reconciliationEvidence is required');
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

  #record(entry, now) { return this.verificationLedger?.record(entry, now) ?? null; }

  #scopesFor(task) {
    const explicit = task.metadata?.mutationScopes ?? [];
    const repositoryScope = task.repository ? [`repo:${task.repository}`] : [];
    return [...new Set([...repositoryScope, ...explicit])];
  }
}

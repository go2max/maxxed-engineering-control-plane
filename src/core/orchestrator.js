import { TaskState } from './task-graph.js';
import { RepairAction } from '../verification/repair-controller.js';
import { buildEvidenceBundle, buildReconciliationRequirement, synthesizeRepairTask } from '../verification/evidence-bundle.js';
import { EngineeringTraceLedger, TraceDisposition } from '../telemetry/engineering-trace.js';
import { workPacketClaimScope, workPacketView } from '../scheduler/work-packet-adapter.js';

export class EngineeringOrchestrator {
  constructor({ graph, scheduler, claims, verifier, repairs, modelRouter, verificationLedger = null, telemetry = new EngineeringTraceLedger() } = {}) {
    if (!graph || !scheduler || !claims || !verifier || !repairs) throw new Error('graph, scheduler, claims, verifier and repairs are required');
    this.graph = graph;
    this.scheduler = scheduler;
    this.claims = claims;
    this.verifier = verifier;
    this.repairs = repairs;
    this.modelRouter = modelRouter ?? null;
    this.verificationLedger = verificationLedger;
    this.telemetry = telemetry;
  }

  dispatch(workers, { now = Date.now(), taskPredicate = () => true, admissionDecision = {} } = {}) {
    this.recoverExpired(now);
    const activeClaims = this.claims.list().map((claim) => {
      const task = this.graph.get(claim.taskKey);
      const packet = workPacketView(task);
      return { taskKey: claim.taskKey, repository: task?.repository ?? null, workerId: claim.ownerId, packetKey: packet.valid ? packet.packetKey : null };
    });
    const proposed = this.scheduler.plan(workers, { now, activeClaims, taskPredicate, admissionDecision });
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
        this.#trace(task, { name: 'control.task.blocked', lane: task.metadata?.lane, stage: 'model-routing', workerId: dispatch.workerId, startedAt: now, completedAt: now, outcome: 'BLOCKED', disposition: TraceDisposition.WAITING, attributes: { reason: 'no eligible model' } });
        continue;
      }
      this.graph.setState(task.key, TaskState.CLAIMED, { workerId: dispatch.workerId, claimId: claim.claimId });
      const span = this.#trace(task, { name: 'control.task.dispatch', lane: task.metadata?.lane, stage: 'scheduling', workerId: dispatch.workerId, model: modelSelection?.model?.id ?? modelSelection?.model?.name ?? null, provider: modelSelection?.model?.provider ?? null, queuedAt: task.createdAt ?? task.metadata?.queuedAt ?? now, startedAt: now, completedAt: now, disposition: TraceDisposition.OVERHEAD, attributes: { score: dispatch.score ?? null, claimId: claim.claimId, workPacketKey: dispatch.workPacket?.packetKey ?? null, workPacketBranch: dispatch.workPacket?.branch ?? null, mutationScopes: scopes } });
      accepted.push({ ...dispatch, claim, modelSelection, telemetry: span ? { traceId: span.traceId, spanId: span.spanId } : null });
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
      this.#trace(task, { name: 'control.task.accept', lane: task.metadata?.lane, stage: 'verification', workerId: claim.ownerId, startedAt: evidence?.startedAt ?? task.updatedAt ?? now, firstOutputAt: evidence?.firstOutputAt ?? null, completedAt: now, outcome: 'ACCEPTED', disposition: TraceDisposition.PRODUCTIVE, model: evidence?.model ?? null, provider: evidence?.provider ?? null, usage: evidence?.usage ?? null, costUsd: evidence?.costUsd ?? null, attributes: { evidenceDigest: bundle.digest, verdict: verification.verdict } });
      this.claims.release(claim);
    } else if (decision.action === RepairAction.RETRY_REPAIR) {
      const attempt = Number(decision.history?.attempts ?? 1);
      repairTask = synthesizeRepairTask({ task, verification, evidence, attempt });
      if (!this.graph.get(repairTask.key)) this.graph.add(repairTask);
      this.graph.setState(taskKey, TaskState.BLOCKED, { reason: 'repair-task-created', verification, repair: decision, repairTaskKey: repairTask.key, evidenceBundle: bundle });
      this.#record({ taskKey, kind: 'repair-required', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest, relatedTaskKey: repairTask.key }, now);
      this.#trace(task, { name: 'control.task.rework', lane: task.metadata?.lane, stage: 'verification-rework', workerId: claim.ownerId, attempt, startedAt: evidence?.startedAt ?? now, completedAt: now, outcome: 'RETRY_REPAIR', disposition: TraceDisposition.FAILED, attributes: { repairTaskKey: repairTask.key, evidenceDigest: bundle.digest } });
      this.claims.release(claim);
    } else if (decision.action === RepairAction.ESCALATE) {
      reconciliation = buildReconciliationRequirement({ taskKey, verification, evidenceBundle: bundle });
      this.graph.setState(taskKey, TaskState.BLOCKED, { verification, escalation: decision, reconciliation, evidenceBundle: bundle });
      this.#record({ taskKey, kind: reconciliation ? 'reconciliation-required' : 'escalation', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest, metadata: { reconciliation } }, now);
      this.#trace(task, { name: 'control.task.escalation', lane: task.metadata?.lane, stage: 'reconciliation', workerId: claim.ownerId, startedAt: now, completedAt: now, outcome: 'ESCALATED', disposition: TraceDisposition.WAITING, attributes: { evidenceDigest: bundle.digest } });
      this.claims.release(claim);
    } else {
      this.graph.setState(taskKey, TaskState.FAILED, { verification, termination: decision, evidenceBundle: bundle });
      this.#record({ taskKey, kind: 'terminal-failure', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest }, now);
      this.#trace(task, { name: 'control.task.failure', lane: task.metadata?.lane, stage: 'terminal-failure', workerId: claim.ownerId, startedAt: evidence?.startedAt ?? now, completedAt: now, outcome: 'FAILED', disposition: TraceDisposition.FAILED, attributes: { evidenceDigest: bundle.digest } });
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
      const acceptedRepair = [...(repair.lineage ?? [])].reverse().find((entry) => entry.state === TaskState.ACCEPTED)?.evidence ?? null;
      if (repair.metadata?.closesParentOnAccept === true) {
        this.repairs.reset(taskKey);
        this.graph.setState(taskKey, TaskState.ACCEPTED, { reason: 'accepted coding repair satisfied parent acceptance', repairTaskKey, verification: acceptedRepair?.verification ?? null, evidenceBundle: acceptedRepair?.evidenceBundle ?? null });
        this.#record({ taskKey, kind: 'repair-gate-accepted', action: 'ACCEPT', relatedTaskKey: repairTaskKey, evidenceDigest: acceptedRepair?.evidenceBundle?.digest ?? null }, now);
        this.#trace(task, { name: 'control.task.repair-gate', lane: task.metadata?.lane, stage: 'repair-gate', startedAt: now, completedAt: now, outcome: 'ACCEPTED', disposition: TraceDisposition.RECOVERY, attributes: { repairTaskKey } });
        return this.graph.get(taskKey);
      }
      this.graph.setState(taskKey, TaskState.READY, { reason: 'accepted repair completed', repairTaskKey });
      this.#record({ taskKey, kind: 'repair-gate-resolved', action: 'READY', relatedTaskKey: repairTaskKey }, now);
      this.#trace(task, { name: 'control.task.repair-gate', lane: task.metadata?.lane, stage: 'repair-gate', startedAt: now, completedAt: now, outcome: 'READY', disposition: TraceDisposition.RECOVERY, attributes: { repairTaskKey } });
      return this.graph.get(taskKey);
    }
    if (reconciliationEvidence) {
      if (reconciliationEvidence.authoritativeStateKnown !== true) throw new Error('authoritative external state must be known');
      if (!reconciliationEvidence.observedStateDigest) throw new Error('observedStateDigest is required');
      this.graph.setState(taskKey, TaskState.READY, { reason: 'external state reconciled', reconciliationEvidence: structuredClone(reconciliationEvidence) });
      this.#record({ taskKey, kind: 'reconciliation-resolved', action: 'READY', metadata: reconciliationEvidence }, now);
      this.#trace(task, { name: 'control.task.reconciliation', lane: task.metadata?.lane, stage: 'reconciliation', startedAt: now, completedAt: now, outcome: 'READY', disposition: TraceDisposition.RECOVERY });
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
      this.graph.setState(task.key, unsafe ? TaskState.BLOCKED : TaskState.READY, { reason: unsafe ? 'claim expired during non-restartable work' : 'claim expired; task returned to frontier', expiredClaim: claim.claimId });
      this.#trace(task, { name: 'control.task.claim-expired', lane: task.metadata?.lane, stage: 'claim-recovery', workerId: claim.ownerId, startedAt: now, completedAt: now, outcome: unsafe ? 'BLOCKED' : 'READY', disposition: TraceDisposition.RECOVERY, attributes: { claimId: claim.claimId, restartable: !unsafe } });
    }
    return expired;
  }

  #record(entry, now) { return this.verificationLedger?.record(entry, now) ?? null; }
  #trace(task, input) {
    return this.telemetry?.record({ ...input, traceId: input.traceId ?? task?.metadata?.telemetry?.traceId, parentSpanId: input.parentSpanId ?? task?.metadata?.telemetry?.spanId ?? null, taskKey: task?.key, repository: task?.repository, branch: task?.metadata?.branch ?? null, commitSha: task?.metadata?.commitSha ?? null, prNumber: task?.metadata?.prNumber ?? null }) ?? null;
  }
  #scopesFor(task) {
    const raw = Array.isArray(task.metadata?.mutationScopes) ? task.metadata.mutationScopes : [];
    const explicit = raw.map((value) => String(value ?? '').trim()).filter(Boolean).map((scope) => {
      if (scope.startsWith('global:') || scope.startsWith('repo:')) return scope;
      return task.repository ? `repo:${task.repository}:${scope}` : scope;
    });
    const repositoryScope = explicit.length ? [] : (task.repository ? [`repo:${task.repository}`] : []);
    const packetScope = workPacketClaimScope(task);
    return [...new Set([...repositoryScope, ...explicit, ...(packetScope ? [packetScope] : [])])];
  }
}

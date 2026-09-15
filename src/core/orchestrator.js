import { TaskState } from './task-graph.js';
import { RepairAction } from '../verification/repair-controller.js';
import { buildEvidenceBundle, buildReconciliationRequirement, synthesizeRepairTask } from '../verification/evidence-bundle.js';
import { EngineeringTraceLedger, TraceDisposition } from '../telemetry/engineering-trace.js';
import { workPacketClaimScope, workPacketView } from '../scheduler/work-packet-adapter.js';
import { evaluateMergeEconomics, isMergeCandidate } from '../economics/merge-economic-gate.js';
import { EconomicImpactCertificate } from '../economics/economic-impact-certificate.js';
import { trajectoryFromCompletion } from '../training/outcome-recorder.js';

export class EngineeringOrchestrator {
  constructor({
    graph, scheduler, claims, verifier, repairs, modelRouter, verificationLedger = null, telemetry = new EngineeringTraceLedger(),
    riskClassifier = null, economicVerifier = null, outcomeRecorder = null, certificateIssuer = null
  } = {}) {
    if (!graph || !scheduler || !claims || !verifier || !repairs) throw new Error('graph, scheduler, claims, verifier and repairs are required');
    this.graph = graph;
    this.scheduler = scheduler;
    this.claims = claims;
    this.verifier = verifier;
    this.repairs = repairs;
    this.modelRouter = modelRouter ?? null;
    this.verificationLedger = verificationLedger;
    this.telemetry = telemetry;
    // Issue #68: independent economic-acceptance authority. When both are supplied, every real
    // merge (a SHA-addressed commit candidate) is classified and, for C3+, gated live and
    // fail-closed in `complete()` below -- see evaluateMergeEconomics / merge-economic-gate.js.
    this.riskClassifier = riskClassifier;
    this.economicVerifier = economicVerifier;
    // Issue #68/#82 gap closer: collects economic evidence and issues the source-bound
    // EconomicImpactCertificate the gate above requires for C3+ merges. Estimation/issuance
    // authority only -- it never decides acceptance, that stays with economicVerifier. When a
    // certificate is issued it is attached to a *copy* of the task's metadata (never mutating the
    // graph) strictly before evaluateMergeEconomics runs below. Optional: a null certificateIssuer
    // simply means no certificate is auto-issued and the existing #82 fail-closed behavior
    // (missing certificate -> REJECT for C3+) applies unchanged.
    this.certificateIssuer = certificateIssuer;
    // Issue #71: accepted/rejected-outcome learning store. Purely observational -- see
    // OutcomeRecorder's contract that a recording failure never affects the accept/reject path.
    this.outcomeRecorder = outcomeRecorder;
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
    let economicGate = null;
    let reconciliation = null;

    if (decision.action === RepairAction.ACCEPT) {
      // Issue #68 fail-closed economic gate: applies only to real, SHA-addressed merges (see
      // evaluateMergeEconomics -- returns null and is a no-op for everything else, so C0-C2 and
      // non-merge task completions are entirely unaffected). A C3+ merge with no validly bound
      // EconomicImpactCertificate (or any other non-ACCEPT verdict from the independent
      // EconomicVerifier) is rejected here, live and blocking -- it is never allowed to reach
      // TaskState.ACCEPTED on functional verification alone.
      // Issue #68/#82 gap closer: if this is a real merge candidate with no certificate already
      // attached, collect evidence and issue one now, upstream of the gate call below. Attaching
      // is done on a metadata copy only (never mutating the stored task) -- see certificateIssuer
      // field comment above. A null/failed issuance leaves gateTask === task, so the existing
      // fail-closed "missing certificate -> REJECT for C3+" behavior is unchanged.
      // Security review finding 1: a certificate present in task.metadata.economics.certificate is
      // agent-supplied data, and task metadata is writable by every agent. It is therefore NEVER
      // trusted merely because it is present -- the old "skip issuance when a certificate is already
      // attached" shortcut let any agent hand-write a passing certificate for a C5 diff. Now every
      // completion checks the presented certificate's signature against the control-plane signing
      // key; anything that does not verify is discarded and the real issuer runs (or, with no
      // issuer configured, the gate simply sees no certificate and fails closed for C3+).
      let gateTask = task;
      if (this.riskClassifier && this.economicVerifier && isMergeCandidate({ task, evidence })) {
        const presented = task?.metadata?.economics?.certificate ?? null;
        if (!presented || !EconomicImpactCertificate.verifySignature(presented)) {
          const issued = this.certificateIssuer ? this.certificateIssuer.issue({ task, evidence, claim, now }) : null;
          const economics = { ...(task?.metadata?.economics ?? {}) };
          if (issued?.certificate) economics.certificate = issued.certificate;
          else delete economics.certificate;
          gateTask = { ...task, metadata: { ...task.metadata, economics } };
          // Persist the attachment onto the real task metadata too (not just the local gate copy)
          // so the certificate is visible on the task returned to callers and in the audit trail --
          // still strictly before evaluateMergeEconomics runs below.
          this.graph.upsert(gateTask);
        }
      }
      economicGate = evaluateMergeEconomics({ task: gateTask, claim, evidence, riskClassifier: this.riskClassifier, economicVerifier: this.economicVerifier });
      if (economicGate && economicGate.verdict.verdict !== 'ACCEPT') {
        this.graph.setState(taskKey, TaskState.BLOCKED, {
          reason: 'economic-verification-failed', verification, evidenceBundle: bundle, economicGate
        });
        this.#record({
          taskKey, kind: 'economic-verification-blocked', verdict: verification.verdict, action: 'ECONOMIC_REJECT',
          evidenceDigest: bundle.digest, metadata: { riskClass: economicGate.classification.class, reasons: economicGate.classification.reasons, econVerdict: economicGate.verdict.verdict, econReason: economicGate.verdict.reason }
        }, now);
        this.#trace(task, {
          name: 'control.task.economic-block', lane: task.metadata?.lane, stage: 'economic-verification', workerId: claim.ownerId,
          startedAt: evidence?.startedAt ?? task.updatedAt ?? now, completedAt: now, outcome: 'BLOCKED', disposition: TraceDisposition.WAITING,
          attributes: { evidenceDigest: bundle.digest, riskClass: economicGate.classification.class, reasons: economicGate.classification.reasons, econVerdict: economicGate.verdict.verdict, econReason: economicGate.verdict.reason, sourceSha: economicGate.sourceSha, candidateSha: economicGate.candidateSha }
        });
        this.claims.release(claim);
        this.#recordOutcome(trajectoryFromCompletion({ task, claim, evidence, verification, finalAcceptance: 'rejected', economicGate, startedAt: evidence?.startedAt, now }));
        return { verification, decision: { ...decision, action: 'ECONOMIC_REJECT' }, evidenceBundle: bundle, repairTask, reconciliation, economicGate, task: this.graph.get(taskKey) };
      }
      this.graph.setState(taskKey, TaskState.ACCEPTED, { verification, evidenceBundle: bundle, ...(economicGate ? { economicGate } : {}) });
      this.#record({ taskKey, kind: 'acceptance', verdict: verification.verdict, action: decision.action, evidenceDigest: bundle.digest }, now);
      this.#trace(task, { name: 'control.task.accept', lane: task.metadata?.lane, stage: 'verification', workerId: claim.ownerId, startedAt: evidence?.startedAt ?? task.updatedAt ?? now, firstOutputAt: evidence?.firstOutputAt ?? null, completedAt: now, outcome: 'ACCEPTED', disposition: TraceDisposition.PRODUCTIVE, model: evidence?.model ?? null, provider: evidence?.provider ?? null, usage: evidence?.usage ?? null, costUsd: evidence?.costUsd ?? null, attributes: { evidenceDigest: bundle.digest, verdict: verification.verdict, ...(economicGate ? { riskClass: economicGate.classification.class } : {}) } });
      this.claims.release(claim);
      this.#recordOutcome(trajectoryFromCompletion({ task, claim, evidence, verification, finalAcceptance: 'accepted', economicGate, startedAt: evidence?.startedAt, now }));
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
      this.#recordOutcome(trajectoryFromCompletion({ task, claim, evidence, verification, finalAcceptance: 'rejected', startedAt: evidence?.startedAt, now }));
    }
    return { verification, decision, evidenceBundle: bundle, repairTask, reconciliation, economicGate, task: this.graph.get(taskKey) };
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
        this.#recordOutcome(trajectoryFromCompletion({ task, evidence: acceptedRepair?.evidenceBundle?.payload?.evidence ?? {}, verification: acceptedRepair?.verification ?? {}, finalAcceptance: 'accepted', now }));
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
  #recordOutcome(raw) {
    // Outcome recording is purely observational (issue #71): a broken/misbehaving recorder must
    // never be able to affect the real accept/reject decision, so this is defensively wrapped in
    // addition to OutcomeRecorder's own internal try/catch.
    try { return this.outcomeRecorder?.record(raw) ?? null; } catch { return null; }
  }
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

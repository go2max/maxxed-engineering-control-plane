import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier, FailureClass, Verdict } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { VerificationLedger } from '../src/verification/verification-ledger.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { buildEvidenceBundle, buildReconciliationRequirement, synthesizeRepairTask } from '../src/verification/evidence-bundle.js';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';

const worker = { workerId: 'producer', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 1, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

function setup() {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const scheduler = new PortfolioScheduler({ graph });
  const verifier = new AcceptanceVerifier();
  const repairs = new RepairController();
  const verificationLedger = new VerificationLedger();
  return { graph, claims, verificationLedger, orchestrator: new EngineeringOrchestrator({ graph, claims, scheduler, verifier, repairs, verificationLedger }) };
}

test('independent verifier requirement fails closed when producer verifies own work', () => {
  const verifier = new AcceptanceVerifier();
  const result = verifier.verify({ acceptance: { requiredChecks: ['tests'], requireIndependentVerifier: true }, evidence: { producerId: 'same', verifierId: 'same', checks: { tests: { ok: true } } } });
  assert.equal(result.verdict, Verdict.REJECT);
  assert.equal(result.independent, false);
});

test('evidence bundle digest is deterministic for equivalent payloads', () => {
  const a = buildEvidenceBundle({ taskKey: 't', acceptance: { requiredChecks: ['a'] }, evidence: { checks: { a: { ok: true } } }, verification: { verdict: 'ACCEPT' }, producerId: 'p', verifierId: 'v', now: 1 });
  const b = buildEvidenceBundle({ taskKey: 't', acceptance: { requiredChecks: ['a'] }, evidence: { checks: { a: { ok: true } } }, verification: { verdict: 'ACCEPT' }, producerId: 'p', verifierId: 'v', now: 2 });
  assert.equal(a.digest, b.digest);
});

test('repair task is deterministic and points back to original task', () => {
  const task = { key: 't1', repository: 'repo', requirements: { capabilities: ['node'] } };
  const verification = { failed: ['tests'], failureClasses: [FailureClass.TEST_FAILURE], reason: 'repairable acceptance failures' };
  const repair = synthesizeRepairTask({ task, verification, attempt: 1 });
  assert.equal(repair.metadata.repairOf, 't1');
  assert.equal(repair.taskClass, 'repair');
  assert.match(repair.dedupeKey, /^t1:repair:/);
});

test('external uncertainty creates reconciliation requirement', () => {
  const verification = { failureClasses: [FailureClass.EXTERNAL_STATE_UNCERTAIN] };
  const bundle = { digest: 'abc' };
  const requirement = buildReconciliationRequirement({ taskKey: 't1', verification, evidenceBundle: bundle });
  assert.equal(requirement.kind, 'external-state-reconciliation');
  assert.equal(requirement.completed, false);
  assert.equal(requirement.evidenceDigest, 'abc');
});

test('repairable failure creates real graph repair work and blocks parent', () => {
  const { graph, orchestrator, verificationLedger } = setup();
  graph.add({ key: 't1', repository: 'repo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const result = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { producerId: 'producer', verifierId: 'verifier', checks: { tests: { ok: false, class: FailureClass.TEST_FAILURE } } }, now: 1001 });
  assert.ok(result.repairTask);
  assert.equal(graph.get(result.repairTask.key).metadata.repairOf, 't1');
  assert.equal(graph.get('t1').state, TaskState.BLOCKED);
  assert.equal(graph.isExecutable('t1'), false);
  assert.equal(verificationLedger.forTask('t1')[0].kind, 'repair-required');
});

test('accepted repair resolves parent gate and returns it to ready frontier', () => {
  const { graph, orchestrator } = setup();
  graph.add({ key: 'parent', repository: 'repo', state: TaskState.BLOCKED });
  graph.add({ key: 'repair', repository: 'repo', state: TaskState.ACCEPTED, metadata: { repairOf: 'parent' } });
  orchestrator.resolveVerificationGate({ taskKey: 'parent', repairTaskKey: 'repair', now: 10 });
  assert.equal(graph.get('parent').state, TaskState.READY);
  assert.equal(graph.isExecutable('parent'), true);
});

test('reconciliation gate fails closed until authoritative state is known', () => {
  const { graph, orchestrator } = setup();
  graph.add({ key: 'external', repository: 'repo', state: TaskState.BLOCKED });
  assert.throws(() => orchestrator.resolveVerificationGate({ taskKey: 'external', reconciliationEvidence: { authoritativeStateKnown: false } }), /authoritative external state/);
  orchestrator.resolveVerificationGate({ taskKey: 'external', reconciliationEvidence: { authoritativeStateKnown: true, observedStateDigest: 'abc123' }, now: 20 });
  assert.equal(graph.get('external').state, TaskState.READY);
});

test('verification ledger persists across runtime snapshot restore', () => {
  const runtime = new ControlPlaneRuntime();
  runtime.verificationLedger.record({ taskKey: 't1', kind: 'terminal-failure', verdict: 'REJECT' }, 10);
  const snapshot = runtime.snapshot();
  const restored = new ControlPlaneRuntime();
  restored.restore(snapshot, 20);
  assert.equal(restored.verificationLedger.forTask('t1').length, 1);
});

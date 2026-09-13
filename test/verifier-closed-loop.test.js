import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier, FailureClass, Verdict } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { buildEvidenceBundle, buildReconciliationRequirement, synthesizeRepairTask } from '../src/verification/evidence-bundle.js';

const worker = { workerId: 'producer', state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 1, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

function setup() {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const scheduler = new PortfolioScheduler({ graph });
  const verifier = new AcceptanceVerifier();
  const repairs = new RepairController();
  return { graph, claims, orchestrator: new EngineeringOrchestrator({ graph, claims, scheduler, verifier, repairs }) };
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

test('orchestrator emits repair task on repairable failure', () => {
  const { graph, orchestrator } = setup();
  graph.add({ key: 't1', repository: 'repo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const result = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { producerId: 'producer', verifierId: 'verifier', checks: { tests: { ok: false, class: FailureClass.TEST_FAILURE } } }, now: 1001 });
  assert.ok(result.repairTask);
  assert.equal(result.repairTask.metadata.repairOf, 't1');
  assert.ok(result.evidenceBundle.digest);
});

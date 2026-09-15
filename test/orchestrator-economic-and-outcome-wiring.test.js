import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { MergeRiskClassifier } from '../src/economics/merge-risk-classifier.js';
import { EconomicVerifier } from '../src/economics/economic-verifier.js';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';
import { OutcomeRecorder } from '../src/training/outcome-recorder.js';
import { readOutcomeLog } from '../src/training/outcome-store.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const worker = { workerId: 'w1', capabilities: ['node'], capacity: { freeSlots: 2, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

function makeOrchestrator({ withEconomics = true, outcomeLogPath = null } = {}) {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const orchestrator = new EngineeringOrchestrator({
    graph, scheduler: new PortfolioScheduler({ graph }), claims, verifier: new AcceptanceVerifier(), repairs: new RepairController(),
    riskClassifier: withEconomics ? new MergeRiskClassifier() : null,
    economicVerifier: withEconomics ? new EconomicVerifier({ policyVersion: 'v1' }) : null,
    outcomeRecorder: outcomeLogPath ? new OutcomeRecorder({ logPath: outcomeLogPath }) : null
  });
  return { graph, claims, orchestrator };
}

function mergeTask(key, economics = {}) {
  return { key, repository: 'go2max/demo', metadata: { execution: { ref: SHA_A, kind: 'coding-agent' }, economics } };
}

test('a C4-risk merge with no economic certificate fails closed: BLOCKED, not ACCEPTED', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1'));
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({
    taskKey: 't1', claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/billing/charge-card.js'] } },
    now: 1001
  });
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.decision.action, 'ECONOMIC_REJECT');
  assert.equal(completed.economicGate.classification.class, 'C5');
  assert.equal(completed.economicGate.verdict.reason, 'missing-required-economic-certificate');
});

test('a C3+ merge with a validly bound certificate accepts normally', () => {
  const { graph, orchestrator } = makeOrchestrator();
  const cert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_B, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 5, provenance: 'measured', confidence: 0.9 });
  graph.add(mergeTask('t1', { touchesScheduledWork: true, certificate: cert }));
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({
    taskKey: 't1', claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/jobs/nightly-sync.js'] } },
    now: 1001
  });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate.verdict.verdict, 'ACCEPT');
});

test('low-risk (C0-C2) merges are unaffected by the economic gate even with no certificate', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1'));
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({
    taskKey: 't1', claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/util/format.js'] } },
    now: 1001
  });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate.classification.class, 'C1');
});

test('a non-merge task completion (no commit SHA) is entirely unaffected by the economic gate', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add({ key: 't1', repository: 'go2max/demo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { checks: { tests: { ok: true } } }, now: 1001 });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate, null);
});

test('a C3+ economic rejection releases the claim so the task is not stuck holding a lease', () => {
  const { graph, claims, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1'));
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  orchestrator.complete({
    taskKey: 't1', claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/billing/charge-card.js'] } },
    now: 1001
  });
  assert.equal(claims.list().length, 0);
});

test('outcome store records real accepted and rejected trajectories from the live completion path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outcome-store-'));
  const logPath = join(dir, 'outcomes.jsonl');
  try {
    const { graph, orchestrator } = makeOrchestrator({ outcomeLogPath: logPath });

    // accepted, low-risk merge
    graph.add(mergeTask('accepted-1'));
    const [d1] = orchestrator.dispatch([worker], { now: 1000 });
    orchestrator.complete({ taskKey: 'accepted-1', claim: d1.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['a.js'] } }, now: 1001 });

    // fail-closed economic rejection
    graph.add(mergeTask('rejected-1', {}));
    const [d2] = orchestrator.dispatch([worker], { now: 1002 });
    orchestrator.complete({ taskKey: 'rejected-1', claim: d2.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/billing/charge-card.js'] } }, now: 1003 });

    const records = readOutcomeLog(logPath);
    assert.equal(records.length, 2);
    const accepted = records.find((r) => r.sourceFingerprint && r.finalAcceptance === 'accepted');
    const rejected = records.find((r) => r.finalAcceptance === 'rejected');
    assert.ok(accepted, 'expected an accepted trajectory record');
    assert.ok(rejected, 'expected a rejected trajectory record');
    assert.ok(rejected.verifierOutcomes.some((v) => v.name === 'economic-verifier' && v.verdict === 'fail'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing outcome recorder never blocks or alters the real accept decision', () => {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const brokenRecorder = { record: () => { throw new Error('disk is on fire'); } };
  const orchestrator = new EngineeringOrchestrator({
    graph, scheduler: new PortfolioScheduler({ graph }), claims, verifier: new AcceptanceVerifier(), repairs: new RepairController(), outcomeRecorder: brokenRecorder
  });
  graph.add({ key: 't1', repository: 'go2max/demo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { checks: { tests: { ok: true } } }, now: 1001 });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
});

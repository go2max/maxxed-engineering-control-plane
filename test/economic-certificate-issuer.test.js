import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { MergeRiskClassifier } from '../src/economics/merge-risk-classifier.js';
import { EconomicVerifier } from '../src/economics/economic-verifier.js';
import { EconomicImpactCertificate } from '../src/economics/economic-impact-certificate.js';
import { EconomicCertificateIssuer, costPerExecutionUsd, amplifySurface } from '../src/economics/economic-certificate-issuer.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const worker = { workerId: 'w1', capabilities: ['node'], capacity: { freeSlots: 2, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

function makeOrchestrator({ policyVersion = 'v1', certificateIssuer = new EconomicCertificateIssuer({ policyVersion }) } = {}) {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const orchestrator = new EngineeringOrchestrator({
    graph, scheduler: new PortfolioScheduler({ graph }), claims, verifier: new AcceptanceVerifier(), repairs: new RepairController(),
    riskClassifier: new MergeRiskClassifier(),
    economicVerifier: new EconomicVerifier({ policyVersion }),
    certificateIssuer
  });
  return { graph, claims, orchestrator };
}

function mergeTask(key, economics = {}) {
  return { key, repository: 'go2max/demo', metadata: { execution: { ref: SHA_A, kind: 'coding-agent' }, economics } };
}

function complete(orchestrator, graph, key, { changedPaths = ['src/jobs/nightly-sync.js'] } = {}) {
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  return orchestrator.complete({
    taskKey: key, claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths } },
    now: 1001
  });
}

test('a real C3+ merge with no certificate is auto-issued one and ACCEPTs', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1', {
    touchesScheduledWork: true,
    evidence: { computeMs: 500, scheduledJobFrequencyPerMonth: 720, confidence: 0.8, provenance: 'measured' }
  }));
  const completed = complete(orchestrator, graph, 't1');
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate.classification.class, 'C3');
  assert.equal(completed.economicGate.verdict.verdict, 'ACCEPT');
  assert.ok(completed.task.metadata.economics.certificate?.certificateId, 'a certificate should have been attached');
  assert.equal(completed.task.metadata.economics.certificate.sourceSha, SHA_A);
  assert.equal(completed.task.metadata.economics.certificate.candidateSha, SHA_B);
});

test('missing economic evidence -> no certificate issued -> C3+ merge is BLOCKED (fail closed)', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1', { touchesScheduledWork: true })); // no `evidence` at all
  const completed = complete(orchestrator, graph, 't1');
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.decision.action, 'ECONOMIC_REJECT');
  assert.equal(completed.economicGate.verdict.reason, 'missing-required-economic-certificate');
});

test('a certificate bound to the wrong SHA (mismatch/tampered) is rejected, never a fabricated pass', () => {
  const { graph, orchestrator } = makeOrchestrator();
  // Certificate is validly issued but for a *different* candidate SHA than the one actually
  // produced -- simulates a stale/tampered certificate being smuggled in.
  const staleCert = EconomicImpactCertificate.issue({ sourceSha: SHA_A, candidateSha: SHA_C, policyVersion: 'v1', riskClass: 'C3', estimatedMonthlyDeltaUsd: 5, provenance: 'measured', confidence: 0.9 });
  graph.add(mergeTask('t1', { touchesScheduledWork: true, certificate: staleCert }));
  const completed = complete(orchestrator, graph, 't1'); // real commitSha is SHA_B
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.economicGate.verdict.reason, 'certificate-not-bound-to-candidate');
});

test('a certificate issued against a stale/mismatched policy version is rejected', () => {
  const { graph, orchestrator } = makeOrchestrator({ certificateIssuer: new EconomicCertificateIssuer({ policyVersion: 'stale-policy-v0' }) });
  graph.add(mergeTask('t1', {
    touchesScheduledWork: true,
    evidence: { computeMs: 500, scheduledJobFrequencyPerMonth: 720, confidence: 0.8, provenance: 'measured' }
  }));
  const completed = complete(orchestrator, graph, 't1');
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.economicGate.verdict.reason, 'certificate-not-bound-to-candidate');
  assert.equal(completed.task.metadata.economics.certificate.policyVersion, 'stale-policy-v0');
});

test('low-confidence estimate below policy minimum -> no certificate issued -> blocks', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1', {
    touchesScheduledWork: true,
    evidence: { computeMs: 500, scheduledJobFrequencyPerMonth: 720, confidence: 0.1, provenance: 'estimated' }
  }));
  const completed = complete(orchestrator, graph, 't1');
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.economicGate.verdict.reason, 'missing-required-economic-certificate');
});

test('recurring formula: cron/polling amplification is captured as cost_per_execution x executions_per_month x fanout x retry_multiplier', () => {
  const cron = amplifySurface({ computeMs: 10, scheduledJobFrequencyPerMonth: 4320, fanOut: 2, retryMultiplier: 3 });
  const perExec = costPerExecutionUsd({ computeMs: 10 });
  assert.ok(Math.abs(cron.estimatedMonthlyDelta - (perExec * 4320 * 2 * 3)) < 1e-9);

  const polling = amplifySurface({ computeMs: 5, pollingCadencePerMinute: 1 });
  const perExecPoll = costPerExecutionUsd({ computeMs: 5 });
  assert.ok(Math.abs(polling.estimatedMonthlyDelta - (perExecPoll * 43_800)) < 1e-6);
});

test('multiple individually-cheap shards become expensive once composed', () => {
  const { graph, orchestrator } = makeOrchestrator();
  const shards = Array.from({ length: 8 }, (_, i) => ({ id: `shard-${i}`, computeMs: 200_000, scheduledJobFrequencyPerMonth: 500 }));
  graph.add(mergeTask('t1', {
    touchesFanOut: true,
    evidence: { shards, confidence: 0.9, provenance: 'measured', sharedSurfaceMultiplier: 1.4 }
  }));
  const completed = complete(orchestrator, graph, 't1');
  const cert = completed.task.metadata.economics.certificate;
  assert.ok(cert, 'certificate should still be issued for composition-expensive shards');
  assert.ok(cert.estimatedMonthlyDeltaUsd > 25, `expected composed monthly delta to exceed the escalation threshold, got ${cert.estimatedMonthlyDeltaUsd}`);
});

test('C4/C5 with material forecast cost requires canary evidence even with a valid certificate', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1', {
    touchesFanOut: true, touchesPaymentOrBilling: true,
    evidence: { computeMs: 5_000_000, scheduledJobFrequencyPerMonth: 100, fanOut: 5, confidence: 0.95, provenance: 'measured' }
    // no canary supplied
  }));
  const completed = complete(orchestrator, graph, 't1', { changedPaths: ['src/billing/charge-card.js'] });
  assert.equal(completed.task.state, TaskState.BLOCKED);
  assert.equal(completed.economicGate.classification.class, 'C5');
  assert.equal(completed.economicGate.verdict.verdict, 'ESCALATE');
  assert.equal(completed.economicGate.verdict.reason, 'high-risk-cost-affecting-merge-requires-canary');
});

test('C4/C5 with canary observed within threshold accepts', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1', {
    touchesFanOut: true, touchesPaymentOrBilling: true,
    evidence: { computeMs: 5_000_000, scheduledJobFrequencyPerMonth: 100, fanOut: 5, confidence: 0.95, provenance: 'measured' },
    canary: { state: 'OBSERVED_WITHIN_THRESHOLD' }
  }));
  const completed = complete(orchestrator, graph, 't1', { changedPaths: ['src/billing/charge-card.js'] });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate.verdict.verdict, 'ACCEPT');
});

test('issuer output is deterministic for identical evidence (same inputs -> same certificate)', () => {
  const issuer = new EconomicCertificateIssuer({ policyVersion: 'v1' });
  const task = mergeTask('t1', { touchesScheduledWork: true, evidence: { computeMs: 500, scheduledJobFrequencyPerMonth: 720, confidence: 0.8, provenance: 'measured' } });
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B } };
  const first = issuer.issue({ task, evidence, claim: { ownerId: 'agent-1' }, now: 5000 });
  const second = issuer.issue({ task, evidence, claim: { ownerId: 'agent-1' }, now: 5000 });
  assert.ok(first?.certificate && second?.certificate);
  assert.equal(first.certificate.certificateId, second.certificate.certificateId);
  assert.equal(first.evidenceDigest, second.evidenceDigest);
  assert.deepEqual(first.certificate.measurements, second.certificate.measurements);
});

test('the issuer never self-certifies: issuer identity colliding with implementer/verifier yields no certificate', () => {
  const issuer = new EconomicCertificateIssuer({ policyVersion: 'v1', issuerId: 'agent-1' });
  const task = mergeTask('t1', { evidence: { computeMs: 500, scheduledJobFrequencyPerMonth: 720, confidence: 0.8 } });
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B } };
  const issued = issuer.issue({ task, evidence, claim: { ownerId: 'agent-1' } });
  assert.equal(issued, null);
});

test('issuer internal failure never fabricates a pass -- returns null', () => {
  const issuer = new EconomicCertificateIssuer({ policyVersion: 'v1' });
  // Malformed evidence that would throw deep inside amplification/measurement math.
  const task = { key: 't1', metadata: { execution: { ref: SHA_A }, economics: { evidence: { shards: 'not-an-array-and-not-object' } } } };
  const evidence = { producerId: 'agent-1', verifierId: 'verifier-1', artifacts: { commitSha: SHA_B } };
  const issued = issuer.issue({ task, evidence, claim: { ownerId: 'other' } });
  assert.equal(issued, null);
});

test('C0-C2 behavior is unchanged: no certificate is auto-issued and no overhead is added', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add(mergeTask('t1')); // no economics flags at all -> C1
  const completed = complete(orchestrator, graph, 't1', { changedPaths: ['src/util/format.js'] });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate.classification.class, 'C1');
  assert.equal(completed.task.metadata.economics.certificate, undefined);
});

test('a non-merge task completion is entirely unaffected by the issuer', () => {
  const { graph, orchestrator } = makeOrchestrator();
  graph.add({ key: 't1', repository: 'go2max/demo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { checks: { tests: { ok: true } } }, now: 1001 });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(completed.economicGate, null);
});

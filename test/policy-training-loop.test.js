import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolicyTrainingLoop, caseResultFromOutcomeRecord } from '../src/training/policy-training-loop.js';
import { appendOutcomeRecord, buildTrajectoryRecord } from '../src/training/outcome-store.js';
import { OutcomeRecorder } from '../src/training/outcome-recorder.js';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';

function withTempLog(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'policy-training-loop-'));
  const logPath = path.join(dir, 'outcomes.jsonl');
  try {
    return fn(logPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRecord(logPath, { taskClass = 'coding', accepted = true, verifierFailed = false, i = 0 } = {}) {
  const record = buildTrajectoryRecord({
    taskClass,
    sourceFingerprint: `fp-${taskClass}-${i}`,
    executor: { id: 'worker-1', model: 'local-model', kind: 'task' },
    finalAcceptance: accepted ? 'accepted' : 'rejected',
    verifierOutcomes: [{ name: 'functional-verifier', verdict: verifierFailed ? 'fail' : 'pass' }],
    latencyMs: 100 + i,
    cost: { usd: 0.01 }
  });
  appendOutcomeRecord(record, logPath);
  return record;
}

test('caseResultFromOutcomeRecord shapes a real outcome-store record into a CaseResult', () => {
  const record = buildTrajectoryRecord({
    taskClass: 'coding',
    sourceFingerprint: 'fp-1',
    executor: { id: 'w', model: 'm', kind: 'task' },
    finalAcceptance: 'accepted',
    verifierOutcomes: [{ name: 'functional-verifier', verdict: 'fail' }],
    latencyMs: 250,
    cost: { usd: 0.02 }
  });
  const caseResult = caseResultFromOutcomeRecord(record);
  assert.equal(caseResult.caseId, record.recordId);
  assert.equal(caseResult.success, true);
  assert.equal(caseResult.hallucinated, true); // accepted despite a failed verifier
  assert.equal(caseResult.latencyMs, 250);
  assert.equal(caseResult.costUsd, 0.02);
});

test('real recorded outcomes flow a candidate from OFFLINE_REPLAY through SHADOW to BENCHMARK automatically', () => {
  withTempLog((logPath) => {
    const loop = new PolicyTrainingLoop({ outcomeLogPath: logPath, minRecordsForShadow: 5, minRecordsForBenchmark: 5 });

    // Not enough evidence yet: no candidate registered. Baseline slice is a weak (mixed) acceptance
    // record, so the later post-shadow slice can show a genuine improvement.
    for (let i = 0; i < 4; i++) writeRecord(logPath, { i, accepted: i % 2 === 0 });
    let actions = loop.sync(1000);
    assert.equal(actions.length, 0);
    assert.equal(loop.registryFor('coding').versions.length, 0);

    // Crossing the shadow threshold registers a candidate and immediately advances it to SHADOW.
    writeRecord(logPath, { i: 4, accepted: false });
    actions = loop.sync(2000);
    const registry = loop.registryFor('coding');
    assert.equal(registry.versions.length, 1);
    assert.equal(registry.getVersion(1).stage, 'SHADOW');
    assert.ok(actions.some((a) => a.action === 'REGISTERED'));
    assert.ok(actions.some((a) => a.action === 'ADVANCED' && a.stage === 'SHADOW'));

    // Live authority is untouched: the candidate in SHADOW has no effect on getActivePolicy.
    const active = registry.getActivePolicy();
    assert.equal(active.isFallback, true);
    assert.equal(active.stage, 'DETERMINISTIC_FALLBACK');

    // Not enough *new* (post-shadow-entry) evidence yet to reach BENCHMARK.
    for (let i = 5; i < 8; i++) writeRecord(logPath, { i });
    actions = loop.sync(3000);
    assert.equal(registry.getVersion(1).stage, 'SHADOW');
    assert.equal(actions.length, 0);

    // Once enough new evidence accumulates during shadow, BENCHMARK runs automatically via the
    // existing, unmodified promoteThroughGate/evaluatePromotionGate -- a strictly improving
    // candidate (higher acceptance rate on the post-shadow slice) promotes to CANARY.
    for (let i = 8; i < 10; i++) writeRecord(logPath, { i }); // now 5 new records since shadow entry
    actions = loop.sync(4000);
    assert.ok(actions.some((a) => a.action === 'ADVANCED' && a.stage === 'BENCHMARK'));
    const gated = actions.find((a) => a.action === 'GATED');
    assert.ok(gated);
    assert.equal(gated.verdict, 'PROMOTE');
    assert.equal(registry.getVersion(1).stage, 'CANARY');

    // The loop never calls recordCanaryResult or finalizePromotion: CANARY and
    // PROMOTION_GATE -> PRODUCTION remain untouched, still requiring their existing explicit steps.
    assert.equal(registry.getVersion(1).lastCanaryResult, undefined);
    assert.equal(registry.getActivePolicy().isFallback, true, 'a CANARY-stage candidate must never gain live authority');
  });
});

test('a candidate that regresses on the post-shadow slice is rejected and stays at BENCHMARK, never reaching live authority', () => {
  withTempLog((logPath) => {
    const loop = new PolicyTrainingLoop({ outcomeLogPath: logPath, minRecordsForShadow: 4, minRecordsForBenchmark: 4 });

    for (let i = 0; i < 4; i++) writeRecord(logPath, { i, accepted: true }); // strong pre-shadow baseline
    loop.sync(1000);
    const registry = loop.registryFor('coding');
    assert.equal(registry.getVersion(1).stage, 'SHADOW');

    for (let i = 4; i < 8; i++) writeRecord(logPath, { i, accepted: false }); // worse post-shadow slice
    const actions = loop.sync(2000);
    const gated = actions.find((a) => a.action === 'GATED');
    assert.equal(gated.verdict, 'REJECT');
    assert.equal(registry.getVersion(1).stage, 'BENCHMARK');
    assert.equal(registry.getActivePolicy().isFallback, true);
  });
});

test('PRODUCTION promotion still requires an explicit approvedBy identifier even for a candidate this loop advanced to CANARY', () => {
  withTempLog((logPath) => {
    const loop = new PolicyTrainingLoop({ outcomeLogPath: logPath, minRecordsForShadow: 3, minRecordsForBenchmark: 3 });
    for (let i = 0; i < 3; i++) writeRecord(logPath, { i, accepted: i % 2 === 0 }); // mixed baseline
    loop.sync(1000);
    for (let i = 3; i < 6; i++) writeRecord(logPath, { i, accepted: true }); // improved post-shadow slice
    loop.sync(2000);

    const registry = loop.registryFor('coding');
    assert.equal(registry.getVersion(1).stage, 'CANARY');

    // The loop's automation stops here. An operator (not this loop) must still run canary
    // monitoring and finalizePromotion, which is itself gated on an explicit approver.
    const controlMetrics = { acceptanceRate: 0.9, costPerTaskUsd: 0.02, latencyMsP50: 400, rollbackRate: 0.01, securityIncidentCount: 0, verifierEscapeRate: 0.001 };
    registry.recordCanaryResult(1, controlMetrics, controlMetrics);
    assert.equal(registry.getVersion(1).stage, 'PROMOTION_GATE');

    assert.throws(() => registry.finalizePromotion(1), /requires an explicit approvedBy/);
    assert.equal(registry.getVersion(1).stage, 'PROMOTION_GATE');
    assert.equal(registry.getActivePolicy().isFallback, true);

    const finalized = registry.finalizePromotion(1, { approvedBy: 'operator:go2max' });
    assert.equal(finalized.stage, 'PRODUCTION');
    assert.equal(registry.getActivePolicy().isFallback, false);
    assert.equal(registry.getActivePolicy().version, 1);
  });
});

test('ControlPlaneRuntime wires a PolicyTrainingLoop on by default and syncPolicyTraining drives it from the same outcomeLogPath OutcomeRecorder writes to', () => {
  withTempLog((logPath) => {
    const runtime = new ControlPlaneRuntime({ outcomeLogPath: logPath });
    assert.ok(runtime.policyTrainingLoop, 'policy training loop should be wired on by default');
    assert.equal(runtime.policyTrainingLoop.outcomeLogPath, logPath);
    assert.equal(runtime.policyTrainingLoop.minRecordsForShadow > 0, true);

    // Record real outcomes the same way the live orchestrator does (via OutcomeRecorder), then
    // drive the same number of cycles the tick threshold requires.
    const recorder = new OutcomeRecorder({ logPath });
    for (let i = 0; i < runtime.policyTrainingLoop.minRecordsForShadow; i++) {
      const result = recorder.record({
        taskClass: 'coding',
        sourceFingerprint: `fp-${i}`,
        executor: { id: 'w', model: 'm', kind: 'task' },
        finalAcceptance: 'accepted',
        verifierOutcomes: [{ name: 'functional-verifier', verdict: 'pass' }]
      });
      assert.equal(result.persisted, true);
    }

    const actions = runtime.syncPolicyTraining(5000);
    assert.ok(actions.some((a) => a.action === 'REGISTERED'));
    assert.equal(runtime.policyTrainingLoop.registryFor('coding').getVersion(1).stage, 'SHADOW');

    const journalRow = runtime.journal.list().find((row) => row.type === 'policy-training.synced');
    assert.ok(journalRow);
  });
});

test('runtime.policyTrainingLoop: null disables the wiring for tests/tests-in-tests that do not want it', () => {
  const runtime = new ControlPlaneRuntime({ policyTrainingLoop: null, outcomeRecorder: null });
  assert.equal(runtime.policyTrainingLoop, null);
  assert.deepEqual(runtime.syncPolicyTraining(1000), []);
});

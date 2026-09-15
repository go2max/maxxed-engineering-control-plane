import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  redactTrajectory,
  validateTrajectoryRecord,
  deriveCounterfactualLabels,
  buildTrajectoryRecord,
  assertNoBenchmarkLeak,
  appendOutcomeRecord,
  readOutcomeLog,
  buildTaskClassBenchmarkSlice,
} from '../src/training/outcome-store.js';

function rawAccepted(overrides = {}) {
  return {
    taskClass: 'coding',
    sourceFingerprint: 'repo:go2max/x@abc123:issue-71',
    executor: { id: 'worker-1', model: 'local-coder-v3', kind: 'coding-agent' },
    shardSize: 1,
    contextBundleId: 'ctx-42',
    actions: [
      { type: 'edit', tool: 'apply_patch', target: 'src/foo.js', ok: true, durationMs: 120 },
      { type: 'test', tool: 'npm test', ok: true, durationMs: 4000 },
    ],
    verifierOutcomes: [{ name: 'unit-tests', verdict: 'pass' }],
    repairPath: { attempts: 0, strategy: 'none', succeeded: null },
    cost: { usd: 0.42, tokensIn: 5000, tokensOut: 800 },
    latencyMs: 15000,
    finalAcceptance: 'accepted',
    rollbackOutcome: null,
    productionOutcome: 'stable',
    summary: 'Patched foo.js to fix null deref; tests pass.',
    ...overrides,
  };
}

test('redactTrajectory drops unknown/free-text fields and keeps allow-listed shape', () => {
  const record = redactTrajectory({ ...rawAccepted(), notes: 'some out-of-band note', internalDebugDump: { x: 1 } });
  assert.equal(record.notes, undefined);
  assert.equal(record.internalDebugDump, undefined);
  assert.equal(record.taskClass, 'coding');
  assert.equal(record.executor.model, 'local-coder-v3');
});

test('redactTrajectory throws on banned fields (secrets / hidden reasoning)', () => {
  assert.throws(() => redactTrajectory({ ...rawAccepted(), apiKey: 'sk-xxx' }), /banned field/);
  assert.throws(() => redactTrajectory({ ...rawAccepted(), chainOfThought: 'first I thought...' }), /banned field/);
  assert.throws(() => redactTrajectory({ ...rawAccepted(), executor: { ...rawAccepted().executor, secretToken: 'abc' } }), /banned field/);
});

test('buildTrajectoryRecord produces a valid, stamped record for an accepted trajectory', () => {
  const record = buildTrajectoryRecord(rawAccepted());
  assert.equal(record.schemaVersion, 1);
  assert.ok(record.recordId);
  assert.ok(record.recordedAt);
  assert.equal(record.split, 'train');
  const { valid, errors } = validateTrajectoryRecord(record);
  assert.equal(valid, true, errors.join('; '));
});

test('buildTrajectoryRecord produces a valid record for a rejected trajectory', () => {
  const record = buildTrajectoryRecord(rawAccepted({ finalAcceptance: 'rejected', verifierOutcomes: [{ name: 'unit-tests', verdict: 'fail' }] }));
  assert.equal(record.finalAcceptance, 'rejected');
  const { valid } = validateTrajectoryRecord(record);
  assert.equal(valid, true);
});

test('validateTrajectoryRecord rejects missing required fields', () => {
  const { valid, errors } = validateTrajectoryRecord({ finalAcceptance: 'accepted' });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('taskClass')));
  assert.ok(errors.some((e) => e.includes('sourceFingerprint')));
});

test('validateTrajectoryRecord rejects an invalid finalAcceptance value', () => {
  const { valid, errors } = validateTrajectoryRecord({
    taskClass: 'coding',
    sourceFingerprint: 'x',
    executor: { model: 'm' },
    finalAcceptance: 'maybe',
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('finalAcceptance')));
});

test('deriveCounterfactualLabels flags repeated failure from repair attempts', () => {
  const record = redactTrajectory(rawAccepted({ repairPath: { attempts: 3, strategy: 'retry', succeeded: true } }));
  const labels = deriveCounterfactualLabels(record);
  assert.equal(labels.repeatedFailure, true);
});

test('deriveCounterfactualLabels flags unnecessary tests conservatively', () => {
  const manyPassingTests = Array.from({ length: 5 }, (_, i) => ({ type: 'test', tool: 'npm test', ok: true, durationMs: 100 * i }));
  const record = redactTrajectory(rawAccepted({ actions: manyPassingTests }));
  const labels = deriveCounterfactualLabels(record);
  assert.equal(labels.unnecessaryTestsRun, true);
});

test('deriveCounterfactualLabels does not flag unnecessary tests when a test failed', () => {
  const tests = [
    { type: 'test', tool: 'npm test', ok: true },
    { type: 'test', tool: 'npm test', ok: false },
    { type: 'test', tool: 'npm test', ok: true },
    { type: 'test', tool: 'npm test', ok: true },
  ];
  const record = redactTrajectory(rawAccepted({ actions: tests, finalAcceptance: 'rejected' }));
  const labels = deriveCounterfactualLabels(record);
  assert.equal(labels.unnecessaryTestsRun, false);
});

test('deriveCounterfactualLabels honors external comparative signals for cheaper-model label', () => {
  const record = redactTrajectory(rawAccepted());
  const labels = deriveCounterfactualLabels(record, { cheaperModelSucceededInShadow: true });
  assert.equal(labels.cheaperModelCouldSolve, true);
});

test('secrets/private context/hidden reasoning are excluded end to end via buildTrajectoryRecord', () => {
  assert.throws(() => buildTrajectoryRecord({ ...rawAccepted(), rawReasoning: 'step by step...' }), /banned field/);
});

test('assertNoBenchmarkLeak throws when a train-split record collides with a held-out fingerprint', () => {
  const record = buildTrajectoryRecord(rawAccepted());
  assert.throws(() => assertNoBenchmarkLeak(record, [record.sourceFingerprint]), /would leak into training data/);
});

test('assertNoBenchmarkLeak allows non-colliding records and non-train splits', () => {
  const record = buildTrajectoryRecord(rawAccepted());
  assert.doesNotThrow(() => assertNoBenchmarkLeak(record, ['some-other-fingerprint']));
  const benchmarkRecord = { ...record, split: 'benchmark' };
  assert.doesNotThrow(() => assertNoBenchmarkLeak(benchmarkRecord, [record.sourceFingerprint]));
});

test('appendOutcomeRecord + readOutcomeLog round-trip through JSONL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outcome-store-test-'));
  const logPath = join(dir, 'nested', 'outcomes.jsonl');
  try {
    const r1 = buildTrajectoryRecord(rawAccepted());
    const r2 = buildTrajectoryRecord(rawAccepted({ finalAcceptance: 'rejected', sourceFingerprint: 'repo:go2max/x@def456:issue-71' }));
    appendOutcomeRecord(r1, logPath);
    appendOutcomeRecord(r2, logPath);
    const records = readOutcomeLog(logPath);
    assert.equal(records.length, 2);
    assert.equal(records[0].recordId, r1.recordId);
    assert.equal(records[1].finalAcceptance, 'rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readOutcomeLog returns [] for a missing file', () => {
  assert.deepEqual(readOutcomeLog('/tmp/does-not-exist-outcome-store-test.jsonl'), []);
});

test('buildTaskClassBenchmarkSlice deterministically splits held-out cases from the training pool', () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    buildTrajectoryRecord(rawAccepted({ sourceFingerprint: `fp-${i}`, recordId: `rec-${String(i).padStart(2, '0')}` }))
  );
  const { benchmarkSlice, trainingPool } = buildTaskClassBenchmarkSlice(records, 'coding', 0.2);
  assert.equal(benchmarkSlice.length, 2);
  assert.equal(trainingPool.length, 8);
  const benchmarkIds = new Set(benchmarkSlice.map((r) => r.recordId));
  for (const r of trainingPool) assert.equal(benchmarkIds.has(r.recordId), false);

  const again = buildTaskClassBenchmarkSlice(records, 'coding', 0.2);
  assert.deepEqual(
    again.benchmarkSlice.map((r) => r.recordId),
    benchmarkSlice.map((r) => r.recordId)
  );
});

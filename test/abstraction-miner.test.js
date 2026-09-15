import test from 'node:test';
import assert from 'node:assert/strict';
import { mineAbstractions } from '../src/leverage/abstraction-miner.js';
import { buildTrajectoryRecord } from '../src/training/outcome-store.js';

function acceptedRecord({ sourceFingerprint, target, costUsd = 1, latencyMs = 5000, recordId }) {
  return buildTrajectoryRecord({
    recordId,
    taskClass: 'coding',
    sourceFingerprint,
    executor: { id: 'worker-1', model: 'local-coder-v3', kind: 'coding-agent' },
    actions: [{ type: 'edit', tool: 'apply_patch', target, ok: true, durationMs: latencyMs }],
    verifierOutcomes: [{ name: 'unit-tests', verdict: 'pass' }],
    cost: { usd: costUsd },
    latencyMs,
    finalAcceptance: 'accepted',
  });
}

test('proposes an abstraction once a signature repeats across enough distinct sources', () => {
  const records = [
    acceptedRecord({ recordId: 'r1', sourceFingerprint: 'repo:a@sha1:1', target: 'src/settings-page.js', costUsd: 1 }),
    acceptedRecord({ recordId: 'r2', sourceFingerprint: 'repo:b@sha1:1', target: 'src/settings-page.js', costUsd: 1.2 }),
    acceptedRecord({ recordId: 'r3', sourceFingerprint: 'repo:c@sha1:1', target: 'src/settings-page.js', costUsd: 0.9 }),
  ];

  const { candidates, consideredRecords } = mineAbstractions(records, { minOccurrences: 3, coordinationCostUsd: 0.5 });
  assert.equal(consideredRecords, 3);
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.distinctSources, 3);
  assert.equal(candidate.reasoningCallsAvoided, 2);
  assert.equal(candidate.proposedAbstractionKind, 'transform');
  assert.ok(candidate.estimatedSavings.netUsd > 0);
  assert.equal(candidate.exampleTargets[0], 'src/settings-page.js');
});

test('does not propose an abstraction below the occurrence threshold', () => {
  const records = [
    acceptedRecord({ recordId: 'r1', sourceFingerprint: 'repo:a@sha1:1', target: 'src/settings-page.js' }),
    acceptedRecord({ recordId: 'r2', sourceFingerprint: 'repo:b@sha1:1', target: 'src/settings-page.js' }),
  ];
  const { candidates } = mineAbstractions(records, { minOccurrences: 3 });
  assert.equal(candidates.length, 0);
});

test('drops candidates whose net savings do not exceed the coordination cost', () => {
  const records = [
    acceptedRecord({ recordId: 'r1', sourceFingerprint: 'repo:a@sha1:1', target: 'src/settings-page.js', costUsd: 0.1 }),
    acceptedRecord({ recordId: 'r2', sourceFingerprint: 'repo:b@sha1:1', target: 'src/settings-page.js', costUsd: 0.1 }),
    acceptedRecord({ recordId: 'r3', sourceFingerprint: 'repo:c@sha1:1', target: 'src/settings-page.js', costUsd: 0.1 }),
  ];
  const { candidates } = mineAbstractions(records, { minOccurrences: 3, coordinationCostUsd: 50 });
  assert.equal(candidates.length, 0);
});

test('ignores rejected records and repeats within a single record', () => {
  const rejected = buildTrajectoryRecord({
    recordId: 'r-rejected',
    taskClass: 'coding',
    sourceFingerprint: 'repo:d@sha1:1',
    executor: { id: 'worker-1', model: 'local-coder-v3', kind: 'coding-agent' },
    actions: [{ type: 'edit', tool: 'apply_patch', target: 'src/settings-page.js', ok: true, durationMs: 1000 }],
    finalAcceptance: 'rejected',
  });
  const withinOneRecord = buildTrajectoryRecord({
    recordId: 'r-multi',
    taskClass: 'coding',
    sourceFingerprint: 'repo:e@sha1:1',
    executor: { id: 'worker-1', model: 'local-coder-v3', kind: 'coding-agent' },
    actions: [
      { type: 'edit', tool: 'apply_patch', target: 'src/settings-page.js', ok: true, durationMs: 1000 },
      { type: 'edit', tool: 'apply_patch', target: 'src/settings-page2.js', ok: true, durationMs: 1000 },
    ],
    finalAcceptance: 'accepted',
  });

  const { candidates, consideredRecords } = mineAbstractions([rejected, withinOneRecord], { minOccurrences: 2 });
  assert.equal(consideredRecords, 1); // rejected record excluded
  assert.equal(candidates.length, 0); // only one distinct source overall
});

test('mining an empty log returns no candidates without throwing', () => {
  const { candidates, consideredRecords, consideredSignatures } = mineAbstractions([]);
  assert.deepEqual(candidates, []);
  assert.equal(consideredRecords, 0);
  assert.equal(consideredSignatures, 0);
});

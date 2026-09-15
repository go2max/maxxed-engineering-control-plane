import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticConflictDetector } from '../src/patch/semantic-conflict-detector.js';

test('flags a semantic conflict between disjoint-file shards sharing an invariant', () => {
  const detector = new SemanticConflictDetector();
  const shards = [
    { key: 'shard-a', semantics: { invariants: ['balance-non-negative'] } },
    { key: 'shard-b', semantics: { invariants: ['balance-non-negative'] } }
  ];
  const conflicts = detector.detectPairwise(shards);
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].reasons.some((r) => r.startsWith('shared-invariant')));
});

test('flags a caller/callee semantic edge across a changed export', () => {
  const detector = new SemanticConflictDetector();
  const shards = [
    { key: 'shard-caller', semantics: { callsInto: ['billing.chargeCard'] } },
    { key: 'shard-callee', semantics: { exports: ['billing.chargeCard'] } }
  ];
  const conflicts = detector.detectPairwise(shards);
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].reasons.some((r) => r.startsWith('caller-callee')));
});

test('disjoint shards with unrelated semantics do not conflict', () => {
  const detector = new SemanticConflictDetector();
  const shards = [
    { key: 'shard-a', semantics: { capabilities: ['cap-a'] } },
    { key: 'shard-b', semantics: { capabilities: ['cap-b'] } }
  ];
  assert.equal(detector.detectPairwise(shards).length, 0);
});

test('detects multi-shard emergent conflict when 3+ shards touch the same capability', () => {
  const detector = new SemanticConflictDetector();
  const shards = [
    { key: 'shard-a', semantics: { capabilities: ['payments'] } },
    { key: 'shard-b', semantics: { capabilities: ['payments'] } },
    { key: 'shard-c', semantics: { capabilities: ['payments'] } }
  ];
  const report = detector.analyze(shards);
  assert.equal(report.multiShard.length, 1);
  assert.equal(report.multiShard[0].participants.length, 3);
  assert.equal(report.blocksComposition, true);
});

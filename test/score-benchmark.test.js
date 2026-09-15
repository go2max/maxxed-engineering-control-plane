import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDomainScores } from '../src/training/score-benchmark.js';

test('aggregates task success rate and hallucination rate from case results', () => {
  const results = [
    { caseId: 'c1', success: true, hallucinated: false, latencyMs: 100, costUsd: 0.001 },
    { caseId: 'c2', success: true, hallucinated: false, latencyMs: 200, costUsd: 0.002 },
    { caseId: 'c3', success: false, hallucinated: true, latencyMs: 300, costUsd: 0.003 },
    { caseId: 'c4', success: true, hallucinated: false, latencyMs: 400, costUsd: 0.004 },
  ];
  const scores = aggregateDomainScores(results);
  assert.equal(scores.taskSuccessRate, 0.75);
  assert.equal(scores.hallucinationRate, 0.25);
  assert.equal(scores.caseCount, 4);
  assert.equal(scores.latencyMsP50, 300);
});

test('regressionRate measures previously-passing cases that now fail against a baseline', () => {
  const results = [
    { caseId: 'c1', success: false },
    { caseId: 'c2', success: true },
    { caseId: 'c3', success: false },
  ];
  const scores = aggregateDomainScores(results, { baselinePassedCaseIds: ['c1', 'c2'] });
  // c1 regressed (was passing, now fails); c2 still passes; c3 wasn't in the baseline so it
  // doesn't count as a regression even though it fails.
  assert.equal(scores.regressionRate, 0.5);
  assert.deepEqual(scores.regressedCaseIds, ['c1']);
});

test('regressionRate is 0 with no baseline supplied (nothing to regress against yet)', () => {
  const results = [{ caseId: 'c1', success: false }];
  const scores = aggregateDomainScores(results);
  assert.equal(scores.regressionRate, 0);
});

test('toolUseCorrectness is null when no case in the run exercises tool use', () => {
  const results = [{ caseId: 'c1', success: true }];
  const scores = aggregateDomainScores(results);
  assert.equal(scores.toolUseCorrectness, null);
});

test('toolUseCorrectness only averages over cases that exercised tool use', () => {
  const results = [
    { caseId: 'c1', success: true, toolUseCorrect: true },
    { caseId: 'c2', success: true, toolUseCorrect: false },
    { caseId: 'c3', success: true }, // no tool use in this case
  ];
  const scores = aggregateDomainScores(results);
  assert.equal(scores.toolUseCorrectness, 0.5);
});

test('throws on empty results rather than silently reporting a fake 0-case score', () => {
  assert.throws(() => aggregateDomainScores([]));
});

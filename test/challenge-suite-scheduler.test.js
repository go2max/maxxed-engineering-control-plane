import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeSuiteScheduler } from '../src/verification/challenge-suite-scheduler.js';

test('unrelated tests are skipped (targeted mode) while affected tests run, until challenge is due', () => {
  const scheduler = new ChallengeSuiteScheduler({ everyNTargeted: 3, minIntervalMs: 0 });
  const decisions = [];
  for (let i = 0; i < 3; i += 1) {
    const decision = scheduler.shouldChallenge({ scopeKey: 'repo-a', selectionMode: 'targeted' });
    decisions.push(decision.challenge);
    scheduler.record({ scopeKey: 'repo-a', wasChallenge: decision.challenge, targetedTests: ['test/affected.test.js'] });
  }
  assert.deepEqual(decisions, [false, false, true]);
});

test('challenge suite catches a deliberately incorrect impact-graph omission (blind spot)', () => {
  const scheduler = new ChallengeSuiteScheduler({ everyNTargeted: 1, minIntervalMs: 0 });
  const decision = scheduler.shouldChallenge({ scopeKey: 'repo-b', selectionMode: 'targeted' });
  assert.equal(decision.challenge, true);
  const finding = scheduler.record({
    scopeKey: 'repo-b',
    wasChallenge: true,
    targetedTests: ['test/impacted.test.js'],
    fullSuiteResult: { failedTests: ['test/impacted.test.js', 'test/unlisted-but-actually-affected.test.js'] }
  });
  assert.equal(finding.blindSpotDetected, true);
  assert.deepEqual(finding.omittedFailingTests, ['test/unlisted-but-actually-affected.test.js']);
  assert.equal(scheduler.blindSpots('repo-b').length, 1);
});

test('no blind spot recorded when full suite failures match the targeted set', () => {
  const scheduler = new ChallengeSuiteScheduler({ everyNTargeted: 1, minIntervalMs: 0 });
  scheduler.shouldChallenge({ scopeKey: 'repo-c', selectionMode: 'targeted' });
  const finding = scheduler.record({
    scopeKey: 'repo-c',
    wasChallenge: true,
    targetedTests: ['test/a.test.js'],
    fullSuiteResult: { failedTests: ['test/a.test.js'] }
  });
  assert.equal(finding.blindSpotDetected, false);
});

test('already-full selection never needs a challenge pass', () => {
  const scheduler = new ChallengeSuiteScheduler();
  const decision = scheduler.shouldChallenge({ scopeKey: 'repo-d', selectionMode: 'full' });
  assert.equal(decision.challenge, false);
  assert.equal(decision.reason, 'already-full');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MergeRiskClassifier, MergeRiskClass } from '../src/economics/merge-risk-classifier.js';
import { MutationSurpriseScorer, SurpriseLevel, autoReclassifyOnSurprise } from '../src/economics/mutation-surprise-scorer.js';

function makeScorer() { return new MutationSurpriseScorer(new MergeRiskClassifier()); }

function evidenceFor(paths, diffText = '') {
  return { artifacts: { changedPaths: paths, diff: diffText } };
}

// --- Acceptance scenario 1: benign expected expansion ---

test('benign: changes fully within declared scope score low and BENIGN', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/button.js', 'src/widgets/card.js'])
  });
  assert.equal(result.level, SurpriseLevel.BENIGN);
  assert.equal(result.score, 0);
  assert.equal(result.undeclaredPaths.length, 0);
  assert.equal(scorer.isSurprising(result), false);
});

test('benign: a repo-wide declared scope covers any changed path (explicit broad intent)', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['repo:org/repo'],
    evidence: evidenceFor(['src/anywhere/deep/file.js'])
  });
  assert.equal(result.level, SurpriseLevel.BENIGN);
});

test('benign: a declared risky surface (task said it would touch retries) is not a surprise', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/jobs'],
    declaredSurfaces: { touchesRetryLogic: true },
    evidence: evidenceFor(['src/jobs/retry.js'], '+ function retry(fn) { return backoff(fn); }')
  });
  assert.equal(scorer.isSurprising(result), false);
});

// --- Acceptance scenario 2: accidental scope creep ---

test('scope creep: some undeclared low-risk paths score MODERATE, not CRITICAL', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/button.js', 'src/widgets/card.js', 'src/utils/format.js'])
  });
  assert.equal(result.undeclaredPaths.length, 1);
  assert.equal(result.undeclaredPaths[0], 'src/utils/format.js');
  assert.equal(result.level, SurpriseLevel.MODERATE);
  assert.ok(result.score > 0 && result.score < 0.5);
});

test('scope creep: majority of changed paths undeclared escalates to HIGH', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/button.js', 'src/auth/session.js', 'src/db/schema.js'])
  });
  assert.equal(result.level, SurpriseLevel.HIGH);
  assert.equal(scorer.isSurprising(result), true);
});

test('scope creep: undeclared symbol touched inside a declared file scope', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    declaredSurfaces: { symbols: ['renderButton'] },
    actualMutation: { symbols: ['renderButton', 'internalAuthCheck'] },
    evidence: evidenceFor(['src/widgets/button.js'])
  });
  assert.ok(result.undeclaredDimensions.includes('symbols'));
  assert.equal(result.level, SurpriseLevel.MODERATE);
});

// --- Acceptance scenario 3: critical hidden mutation ---

test('critical: undeclared permissions change forces CRITICAL regardless of file scope', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/button.js']),
    actualMutation: { permissions: ['grant:admin'] }
  });
  assert.equal(result.level, SurpriseLevel.CRITICAL);
  assert.ok(result.reasons.some((r) => r.includes('permissions')));
  assert.equal(scorer.isSurprising(result), true);
});

test('critical: undeclared schema change forces CRITICAL', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/models'],
    evidence: evidenceFor(['src/models/user.js']),
    actualMutation: { schema: true }
  });
  assert.equal(result.level, SurpriseLevel.CRITICAL);
});

test('critical: diff-derived payment surface with no declared hint is CRITICAL via reused MergeRiskClassifier signal', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/widgets'],
    declaredObjective: 'Improve button rendering performance',
    evidence: evidenceFor(['src/widgets/checkout.js'], '+ chargeCard(customer, amount);')
  });
  assert.equal(result.riskClassification.class, MergeRiskClass.C5);
  assert.equal(result.level, SurpriseLevel.CRITICAL);
  assert.ok(result.reasons.some((r) => r.startsWith('undeclared-risk-surface')));
});

test('critical: task declaring the objective mentions the risky surface avoids false escalation from that signal', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: ['src/billing'],
    declaredObjective: 'Add payment retry handling to billing module',
    declaredSurfaces: { touchesPaymentOrBilling: true },
    evidence: evidenceFor(['src/billing/charge.js'], '+ chargeCard(customer, amount);')
  });
  assert.equal(scorer.isSurprising(result), false);
});

// --- fail-closed / no-evidence behavior ---

test('fail-closed: real changes with zero declared scope is HIGH, not vacuously benign', () => {
  const scorer = makeScorer();
  const result = scorer.score({
    declaredScopes: [],
    evidence: evidenceFor(['src/anything.js'])
  });
  assert.equal(result.level, SurpriseLevel.HIGH);
  assert.ok(result.reasons.includes('no-declared-scope-fail-closed'));
});

test('constructor requires a classify-compatible riskClassifier', () => {
  assert.throws(() => new MutationSurpriseScorer(null));
  assert.throws(() => new MutationSurpriseScorer({}));
});

// --- autoReclassifyOnSurprise hook (not wired into live accept path; unit-tested standalone) ---

test('autoReclassifyOnSurprise: BENIGN/MODERATE results do not escalate', () => {
  const scorer = makeScorer();
  const benign = scorer.score({ declaredScopes: ['src/widgets'], evidence: evidenceFor(['src/widgets/a.js']) });
  const moderate = scorer.score({ declaredScopes: ['src/widgets'], evidence: evidenceFor(['src/widgets/a.js', 'src/widgets/b.js', 'src/utils/c.js']) });
  assert.equal(autoReclassifyOnSurprise({ surpriseResult: benign, currentClass: MergeRiskClass.C1 }).shouldEscalate, false);
  assert.equal(autoReclassifyOnSurprise({ surpriseResult: moderate, currentClass: MergeRiskClass.C1 }).shouldEscalate, false);
});

test('autoReclassifyOnSurprise: HIGH floors the class at C4', () => {
  const scorer = makeScorer();
  const high = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/a.js', 'src/auth/b.js', 'src/db/c.js'])
  });
  assert.equal(high.level, SurpriseLevel.HIGH);
  const result = autoReclassifyOnSurprise({ surpriseResult: high, currentClass: MergeRiskClass.C1, riskClassifier: new MergeRiskClassifier() });
  assert.equal(result.shouldEscalate, true);
  assert.equal(result.escalatedClass, MergeRiskClass.C4);
});

test('autoReclassifyOnSurprise: CRITICAL floors the class at C5', () => {
  const scorer = makeScorer();
  const critical = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/a.js']),
    actualMutation: { permissions: ['grant:admin'] }
  });
  const result = autoReclassifyOnSurprise({ surpriseResult: critical, currentClass: MergeRiskClass.C2, riskClassifier: new MergeRiskClassifier() });
  assert.equal(result.shouldEscalate, true);
  assert.equal(result.escalatedClass, MergeRiskClass.C5);
});

test('autoReclassifyOnSurprise: never downgrades a class already above the floor', () => {
  const scorer = makeScorer();
  const high = scorer.score({
    declaredScopes: ['src/widgets'],
    evidence: evidenceFor(['src/widgets/a.js', 'src/auth/b.js', 'src/db/c.js'])
  });
  const result = autoReclassifyOnSurprise({ surpriseResult: high, currentClass: MergeRiskClass.C5, riskClassifier: new MergeRiskClassifier() });
  assert.equal(result.shouldEscalate, true);
  assert.equal(result.escalatedClass, MergeRiskClass.C5);
});

test('autoReclassifyOnSurprise: no surpriseResult is a safe no-op', () => {
  const result = autoReclassifyOnSurprise({ currentClass: MergeRiskClass.C2 });
  assert.equal(result.shouldEscalate, false);
  assert.equal(result.escalatedClass, MergeRiskClass.C2);
});

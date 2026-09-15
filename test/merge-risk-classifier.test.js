import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MergeRiskClassifier, MergeRiskClass } from '../src/economics/merge-risk-classifier.js';

test('docs-only changes remain low overhead (C0)', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({ changedPaths: ['README.md', 'docs/guide.md'], docsOnly: true });
  assert.equal(result.class, MergeRiskClass.C0);
});

test('a tiny diff introducing a high-frequency recurring cost surface is escalated to C3+', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({
    changedPaths: ['src/jobs/nightly-sync.js'],
    diffText: '+ setInterval(() => pollExternalApi(), 1000);',
    touchesScheduledWork: true
  });
  assert.ok(classifier.compare(result.class, MergeRiskClass.C3) >= 0, `expected >= C3, got ${result.class}`);
});

test('payment/billing surface escalates to C5', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({ changedPaths: ['src/billing/charge-card.js'], touchesPaymentOrBilling: true });
  assert.equal(result.class, MergeRiskClass.C5);
});

test('composition amplification escalates otherwise-low-risk participants', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({ changedPaths: ['src/util/format.js'], compositionParticipants: 5 });
  assert.ok(classifier.compare(result.class, MergeRiskClass.C3) >= 0);
});

test('SECURITY: no diff/changedPaths evidence at all fails closed to C3+, not silently C1', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({});
  assert.ok(classifier.compare(result.class, MergeRiskClass.C3) >= 0, `expected >= C3, got ${result.class}`);
  assert.ok(classifier.requiresEconomicCertificate(result.class));
});

test('SECURITY: docsOnly asserted with no changedPaths is not vacuously C0', () => {
  const classifier = new MergeRiskClassifier();
  const result = classifier.classify({ docsOnly: true, changedPaths: [] });
  assert.notEqual(result.class, MergeRiskClass.C0);
  assert.ok(classifier.compare(result.class, MergeRiskClass.C3) >= 0, `expected >= C3, got ${result.class}`);
  assert.ok(classifier.requiresEconomicCertificate(result.class));
});

test('requiresEconomicCertificate is true only for C3 and above', () => {
  const classifier = new MergeRiskClassifier();
  assert.equal(classifier.requiresEconomicCertificate(MergeRiskClass.C2), false);
  assert.equal(classifier.requiresEconomicCertificate(MergeRiskClass.C3), true);
  assert.equal(classifier.requiresEconomicCertificate(MergeRiskClass.C5), true);
});

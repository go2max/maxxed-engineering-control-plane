import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReuseDeclaration } from '../scripts/check-reuse-gate.mjs';
import { computeReuseMetrics } from '../scripts/reuse-metrics.mjs';

test('parseReuseDeclaration accepts a well-formed internal reuse declaration', () => {
  const body = 'reuse: internal\nreused-component: src/training/promotion-gate.js\n';
  const result = parseReuseDeclaration(body);
  assert.equal(result.valid, true);
  assert.equal(result.category, 'internal');
});

test('parseReuseDeclaration accepts a well-formed external reuse declaration', () => {
  const body = [
    'reuse: external',
    'source-repo: temporalio/temporal',
    'source-ref: service/history/queues/scheduler.go@v1.24.0',
    'license: MIT',
    'adapted-as: adapted',
  ].join('\n');
  const result = parseReuseDeclaration(body);
  assert.equal(result.valid, true);
  assert.equal(result.fields['source-repo'], 'temporalio/temporal');
});

test('parseReuseDeclaration rejects missing reuse line', () => {
  const result = parseReuseDeclaration('Just a summary, no reuse section.');
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('no "reuse:" line'));
});

test('parseReuseDeclaration rejects unrecognized category', () => {
  const result = parseReuseDeclaration('reuse: maybe\n');
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('not a recognized category'));
});

test('parseReuseDeclaration rejects external declaration missing required fields', () => {
  const result = parseReuseDeclaration('reuse: external\nsource-repo: foo/bar\n');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('source-ref')));
  assert.ok(result.errors.some((e) => e.includes('license')));
});

test('parseReuseDeclaration rejects unfilled template placeholder', () => {
  const result = parseReuseDeclaration('reuse: none\nreason: <why no suitable existing implementation was found>\n');
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('reason'));
});

test('parseReuseDeclaration rejects a body with two reuse lines', () => {
  const result = parseReuseDeclaration('reuse: internal\nreused-component: x\nreuse: none\nreason: y\n');
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('exactly one'));
});

test('parseReuseDeclaration accepts a well-formed none declaration with a real reason', () => {
  const result = parseReuseDeclaration('reuse: none\nreason: genuinely novel Maxxed-specific business logic\n');
  assert.equal(result.valid, true);
});

test('computeReuseMetrics tallies categories and avoided-hours across PR bodies', () => {
  const bodies = [
    { id: '#1', body: 'reuse: internal\nreused-component: src/x.js\nEstimated avoided engineering time: ~2 engineer-days avoided.' },
    { id: '#2', body: 'reuse: external\nsource-repo: a/b\nsource-ref: c\nlicense: MIT\nadapted-as: adapted' },
    { id: '#3', body: 'reuse: none\nreason: unique business logic' },
    { id: '#4', body: 'no reuse section at all' },
  ];
  const metrics = computeReuseMetrics(bodies);
  assert.equal(metrics.totalCount, 4);
  assert.equal(metrics.byCategory.internal, 1);
  assert.equal(metrics.byCategory.external, 1);
  assert.equal(metrics.byCategory.none, 1);
  assert.equal(metrics.byCategory.unlabeled, 1);
  assert.equal(metrics.reusedCount, 2);
  assert.equal(metrics.newlyAuthoredCount, 1);
  assert.equal(metrics.totalAvoidedHours, 16);
});

test('computeReuseMetrics handles an empty input set without dividing by zero', () => {
  const metrics = computeReuseMetrics([]);
  assert.equal(metrics.totalCount, 0);
  assert.equal(metrics.reuseRate, 0);
});

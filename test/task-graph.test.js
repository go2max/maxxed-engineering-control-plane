import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';

test('frontier exposes only dependency-complete ungated tasks', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a' });
  graph.add({ key: 'b', dependencies: ['a'] });
  graph.add({ key: 'c', humanGates: ['owner-approval'] });
  assert.deepEqual(graph.frontier().map((task) => task.key), ['a']);
  graph.setState('a', TaskState.ACCEPTED, { sha: 'abc' });
  assert.deepEqual(graph.frontier().map((task) => task.key), ['b']);
});

test('dedupe keys and dependency cycles are rejected', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', dedupeKey: 'same', dependencies: ['b'] });
  assert.throws(() => graph.add({ key: 'x', dedupeKey: 'same' }), /duplicate dedupe key/);
  assert.throws(() => graph.add({ key: 'b', dependencies: ['a'] }), /dependency cycle/);
});

test('unlock count identifies direct dependency leverage', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'root' });
  graph.add({ key: 'ready-after-root', dependencies: ['root'] });
  graph.add({ key: 'also-needs-other', dependencies: ['root', 'other'] });
  graph.add({ key: 'other' });
  assert.equal(graph.unlockCount('root'), 1);
  graph.setState('other', TaskState.ACCEPTED);
  assert.equal(graph.unlockCount('root'), 2);
});

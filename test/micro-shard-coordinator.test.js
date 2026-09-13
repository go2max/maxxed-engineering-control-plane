import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { MicroShardPlanner } from '../src/patch/shard-planner.js';
import { PatchFabric } from '../src/patch/patch-fabric.js';
import { MicroShardCoordinator } from '../src/patch/micro-shard-coordinator.js';
import { createPatchBundle } from '../src/patch/patch-bundle.js';

const BASE = 'a'.repeat(40);
const ACCEPTED = 'b'.repeat(40);

function evidenceBundle({ patchBundle = null, commitSha = null, branchName = null, pushed = false } = {}) {
  return {
    digest: `bundle:${commitSha ?? patchBundle?.shardKey ?? 'x'}`,
    payload: {
      evidence: {
        artifacts: { patchBundle, commitSha, branchName, pushed }
      }
    }
  };
}

function runtimeHarness() {
  const graph = new TaskGraph();
  const events = [];
  return {
    graph,
    events,
    journal: { append(type, payload) { events.push({ type, payload }); } },
    ingest(task) { return graph.add(task); }
  };
}

function addShardableParent(runtime, key = 'parent') {
  runtime.graph.add({
    key, repository: 'org/repo', objective: 'rename four independent files', state: TaskState.READY,
    riskClass: 'normal', taskClass: 'migration', requirements: { capabilities: ['coding-agent', 'git', 'node'] },
    metadata: {
      priority: 10,
      acceptance: { requiredChecks: ['full'] },
      execution: {
        kind: 'coding-agent', repoPath: '/repo', ref: BASE, baseBranch: 'main', branchBase: `maxxed/agent/${key}`,
        goal: 'rename files', testCommands: [{ name: 'full', command: 'npm', args: ['test'] }], autoCommit: true, autoPush: true,
        precomputedWrites: [1, 2, 3, 4].map((n) => ({ path: `src/f${n}.js`, content: `export const n = ${n};\n` })),
        microSharding: { estimatedMonolithicMs: 60_000, maxShards: 4 }
      }
    }
  });
}

test('micro-shard coordinator fans out, composes, verifies once, and accepts only the parent', () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const planner = new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0, targetLines: 100, maxLines: 150 });
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: planner });
  addShardableParent(runtime);

  const materialized = coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });
  assert.equal(materialized.length, 1);
  const parentBlocked = runtime.graph.get('parent');
  assert.equal(parentBlocked.state, TaskState.BLOCKED);
  const shards = runtime.graph.list().filter((task) => task.metadata?.patchFabric?.kind === 'shard');
  assert.ok(shards.length >= 2);
  assert.equal(new Set(shards.flatMap((task) => task.metadata.execution.patchBundle.scope.files)).size, 4);
  assert.ok(shards.every((task) => task.metadata.suppressPromotion === true));

  const reconciled = [];
  for (const [index, shard] of shards.entries()) {
    const file = shard.metadata.execution.patchBundle.scope.files[0];
    const beforeContent = `// old ${file}\n`;
    const afterContent = shard.metadata.execution.precomputedWrites?.find((write) => write.path === file)?.content ?? `// changed ${file}\n`;
    const patchBundle = createPatchBundle({
      taskKey: shard.key,
      parentTaskKey: 'parent',
      shardKey: shard.key,
      repository: 'org/repo',
      baseSha: BASE,
      workerId: `worker-${index + 1}`,
      generation: 1,
      scope: shard.metadata.execution.patchBundle.scope,
      writes: [{ path: file, beforeContent, content: afterContent }],
      checks: {}
    });
    runtime.graph.setState(shard.key, TaskState.ACCEPTED, { evidenceBundle: evidenceBundle({ patchBundle }) });
    reconciled.push({ taskKey: shard.key, action: 'ACCEPT' });
  }

  const first = coordinator.reconcile(reconciled, { now: 200 });
  assert.equal(first.submitted.length, shards.length);
  assert.equal(first.composed.length, 1);
  const integration = runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'composition');
  assert.ok(integration);
  assert.equal(integration.metadata.suppressPromotion, true);
  assert.equal(integration.metadata.execution.autoPush, true);
  assert.equal(integration.metadata.execution.testCommands[0].name, 'full');

  const finalBundle = evidenceBundle({ commitSha: ACCEPTED, branchName: 'maxxed/agent/parent-g1', pushed: true });
  runtime.graph.setState(integration.key, TaskState.ACCEPTED, { evidenceBundle: finalBundle });
  const second = coordinator.reconcile([{ taskKey: integration.key, action: 'ACCEPT' }], { now: 300 });
  assert.equal(second.acceptedParents.length, 1);
  const parent = runtime.graph.get('parent');
  assert.equal(parent.state, TaskState.ACCEPTED);
  const acceptedEvidence = parent.lineage.at(-1).evidence.evidenceBundle;
  assert.equal(acceptedEvidence.payload.evidence.artifacts.commitSha, ACCEPTED);
  assert.equal(patchFabric.list()[0].state, 'ACCEPTED');
});

test('terminal shard failure fails patch session and parent instead of hanging', () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0 }) });
  addShardableParent(runtime, 'terminal-parent');
  coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });
  const shard = runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'shard');
  runtime.graph.setState(shard.key, TaskState.FAILED, { reason: 'repair budget exhausted' });

  const result = coordinator.reconcile([{ taskKey: shard.key, action: 'TERMINATE' }], { now: 200 });
  assert.equal(result.failedParents.length, 1);
  assert.equal(runtime.graph.get('terminal-parent').state, TaskState.FAILED);
  assert.equal(patchFabric.list()[0].state, 'FAILED');
  assert.equal(patchFabric.list()[0].failures.at(-1).phase, 'shard');
});

test('terminal repair failure also fails the owning shard session and parent', () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0 }) });
  addShardableParent(runtime, 'repair-parent');
  coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });
  const shard = runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'shard');
  runtime.graph.setState(shard.key, TaskState.BLOCKED, { reason: 'repair-task-created' });
  runtime.graph.add({
    key: `${shard.key}:repair`, repository: shard.repository, objective: 'repair shard', state: TaskState.FAILED,
    requirements: shard.requirements,
    metadata: { repairOf: shard.key, execution: { kind: 'coding-agent' } }
  });

  const result = coordinator.reconcile([{ taskKey: `${shard.key}:repair`, action: 'TERMINATE' }], { now: 250 });
  assert.equal(result.failedParents.length, 1);
  assert.equal(runtime.graph.get(shard.key).state, TaskState.FAILED);
  assert.equal(runtime.graph.get('repair-parent').state, TaskState.FAILED);
  assert.equal(patchFabric.list()[0].state, 'FAILED');
});

test('critical-risk parent is not micro-sharded', () => {
  const runtime = runtimeHarness();
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric: new PatchFabric(), shardPlanner: new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0 }) });
  runtime.graph.add({
    key: 'critical-parent', repository: 'org/repo', objective: 'critical change', state: TaskState.READY, riskClass: 'critical',
    requirements: { capabilities: ['coding-agent'] },
    metadata: { execution: { kind: 'coding-agent', repoPath: '/repo', ref: BASE, branchBase: 'maxxed/critical', precomputedWrites: [{ path: 'a', content: '1' }, { path: 'b', content: '2' }] } }
  });
  assert.deepEqual(coordinator.materialize({ workers: [{ capacity: { freeSlots: 8 } }], verifierSlots: 8 }), []);
  assert.equal(runtime.graph.get('critical-parent').state, TaskState.READY);
});

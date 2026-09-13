import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { MicroShardPlanner } from '../src/patch/shard-planner.js';
import { PatchFabric } from '../src/patch/patch-fabric.js';
import { MicroShardCoordinator } from '../src/patch/micro-shard-coordinator.js';

const BASE = 'a'.repeat(40);

function runtimeHarness() {
  const graph = new TaskGraph();
  return { graph, journal: { append() {} }, ingest(task) { return graph.add(task); } };
}

test('explicit reasoning shards do not inherit parent-wide deterministic writes', () => {
  const runtime = runtimeHarness();
  const coordinator = new MicroShardCoordinator({
    runtime,
    patchFabric: new PatchFabric(),
    shardPlanner: new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0, targetLines: 100, maxLines: 120 })
  });
  runtime.graph.add({
    key: 'parent', repository: 'org/repo', objective: 'two independent reasoning changes', state: TaskState.READY,
    riskClass: 'normal', requirements: { capabilities: ['coding-agent'] },
    metadata: {
      modelRequest: { capabilities: ['coding'], taskClass: 'coding' },
      execution: {
        kind: 'coding-agent', ref: BASE, branchBase: 'maxxed/parent', baseBranch: 'main',
        precomputedWrites: [{ path: 'should-not-leak.js', content: 'leak' }],
        microSharding: {
          estimatedMonolithicMs: 100000,
          units: [
            { id: 'a', files: ['src/a.js'], estimatedLines: 80, estimatedMs: 5000, payload: { objective: 'edit a' } },
            { id: 'b', files: ['src/b.js'], estimatedLines: 80, estimatedMs: 5000, payload: { objective: 'edit b' } }
          ]
        }
      }
    }
  });
  const created = coordinator.materialize({ workers: [{ capacity: { freeSlots: 2 } }], verifierSlots: 2, composerSlots: 1 });
  assert.equal(created.length, 1);
  const shards = runtime.graph.list().filter((task) => task.metadata?.patchFabric?.kind === 'shard');
  assert.equal(shards.length, 2);
  for (const shard of shards) {
    assert.equal(shard.metadata.execution.precomputedWrites, undefined);
    assert.equal(shard.metadata.execution.transformId, undefined);
    assert.ok(shard.metadata.modelRequest);
    assert.ok(!shard.metadata.execution.patchBundle.scope.files.includes('should-not-leak.js'));
  }
});

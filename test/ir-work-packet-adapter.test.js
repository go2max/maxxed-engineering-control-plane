import test from 'node:test';
import assert from 'node:assert/strict';
import { compileIntent } from '../src/ir/compiler.js';
import { compileWorkIRToTasks } from '../src/ir/work-packet-adapter.js';
import { workPacketView } from '../src/scheduler/work-packet-adapter.js';
import { TaskGraph } from '../src/core/task-graph.js';
import { OperationType } from '../src/ir/operation-types.js';

function demoIR() {
  return compileIntent({
    irKey: 'issue-97-demo',
    operations: [
      {
        id: 'add-endpoint',
        type: OperationType.CREATE_ARTIFACT,
        intent: 'add /health endpoint',
        target: { repository: 'go2max/demo', artifactPath: 'src/health.js' },
        mutationScope: ['src/health.js']
      },
      {
        id: 'wire-endpoint',
        type: OperationType.MODIFY_CONTRACT,
        intent: 'wire /health into router',
        target: { repository: 'go2max/demo', contract: 'router' },
        mutationScope: ['src/router.js'],
        dependsOn: ['add-endpoint']
      },
      {
        id: 'validate-release',
        type: OperationType.VALIDATE_RELEASE,
        intent: 'validate the release',
        target: { repository: 'go2max/demo', releaseKey: 'demo-r1' },
        dependsOn: ['wire-endpoint'],
        release: { requiresHumanGate: true }
      }
    ]
  });
}

test('compileWorkIRToTasks produces task-graph-compatible tasks that load cleanly into TaskGraph', () => {
  const ir = demoIR();
  const { tasks, workPackets } = compileWorkIRToTasks(ir);

  assert.equal(tasks.length, 3);
  assert.equal(workPackets.length, 1);

  const graph = new TaskGraph();
  for (const task of tasks) graph.add(task);

  assert.equal(graph.list().length, 3);
  const wire = graph.get('issue-97-demo:wire-endpoint');
  assert.deepEqual(wire.dependencies, ['issue-97-demo:add-endpoint']);

  const validate = graph.get('issue-97-demo:validate-release');
  assert.deepEqual(validate.humanGates, ['ir:issue-97-demo:validate-release:release-gate']);
  assert.equal(validate.riskClass, 'high'); // risk floor from ValidateRelease
});

test('compileWorkIRToTasks groups same-repository operations into one backward-compatible work packet', () => {
  const ir = demoIR();
  const { tasks, workPackets } = compileWorkIRToTasks(ir, { baseCommit: 'a'.repeat(40) });

  assert.equal(workPackets.length, 1);
  const packet = workPackets[0];
  assert.equal(packet.repository, 'go2max/demo');
  assert.equal(packet.memberTaskIds.length, 3);
  assert.equal(packet.baseCommit, 'a'.repeat(40));

  // Every produced task's embedded work packet must satisfy the existing scheduler adapter's
  // own contract validator unchanged (this is the "backward adapter" requirement from #97).
  for (const task of tasks) {
    const view = workPacketView(task);
    assert.equal(view.valid, true, `task ${task.key} should carry a valid work-packet contract`);
    assert.equal(view.packetKey, packet.packetKey);
  }
});

test('compileWorkIRToTasks splits operations across repositories into separate work packets', () => {
  const ir = compileIntent({
    irKey: 'multi-repo',
    operations: [
      { id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' }, mutationScope: ['a.js'] },
      { id: 'b', type: OperationType.CREATE_ARTIFACT, intent: 'b', target: { repository: 'go2max/other', artifactPath: 'b.js' }, mutationScope: ['b.js'] }
    ]
  });
  const { tasks, workPackets } = compileWorkIRToTasks(ir);
  assert.equal(workPackets.length, 2);
  assert.deepEqual(new Set(tasks.map((t) => t.repository)), new Set(['go2max/demo', 'go2max/other']));
});

test('compileWorkIRToTasks refuses a work IR whose hash has been tampered with', () => {
  const ir = demoIR();
  const tampered = structuredClone(ir);
  tampered.operations[0].riskClass = 'critical';
  assert.throws(() => compileWorkIRToTasks(tampered), /invalid hash/);
});

test('compiled tasks carry the IR hash/version binding for evidence/outcome traceability', () => {
  const ir = demoIR();
  const { tasks } = compileWorkIRToTasks(ir);
  for (const task of tasks) {
    assert.equal(task.metadata.ir.irKey, ir.irKey);
    assert.equal(task.metadata.ir.hash, ir.hash);
  }
});

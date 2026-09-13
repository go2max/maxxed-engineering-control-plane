import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCodingTask, fabricTaskFromDispatch } from '../src/agents/coding-task.js';
import { ThroughputGovernor } from '../src/scheduler/throughput-governor.js';
import { synthesizeRepairTask } from '../src/verification/evidence-bundle.js';

test('coding task compiler produces bounded generation-scoped fabric payload', () => {
  const task = compileCodingTask({
    key: 'issue-123', repository: 'Maxxed-Technical-Systems/demo', repoPath: 'C:/repos/demo',
    objective: 'Fix the failing validation', testCommands: [{ name: 'unit', command: 'npm', args: ['test'] }]
  });
  assert.equal(task.state, 'READY');
  assert.deepEqual(task.requirements.capabilities, ['coding-agent', 'git', 'node']);
  assert.equal(task.metadata.execution.kind, 'coding-agent');
  assert.equal(task.metadata.execution.branchBase, 'maxxed/agent/issue-123');
  assert.equal(task.metadata.execution.autoCommit, true);
  assert.equal(task.metadata.execution.autoPush, true);

  const dispatch = { workerId: 'worker-1', claim: { taskKey: task.key, ownerId: 'worker-1', claimId: 'claim-1', generation: 3 } };
  const fabric = fabricTaskFromDispatch(task, dispatch);
  assert.equal(fabric.taskId, 'claim-1');
  assert.equal(fabric.preferredWorkerId, 'worker-1');
  assert.equal(fabric.payload.controlPlaneTaskKey, 'issue-123');
  assert.equal(fabric.payload.branchName, 'maxxed/agent/issue-123-g3');
  assert.equal(fabric.payload.autoPush, false);
  assert.equal(fabric.payload.publishAfterLeaseValidation, true);
});

test('coding repair task continues from failed attempt commit', () => {
  const task = compileCodingTask({ key: 'issue-124', repository: 'Maxxed-Technical-Systems/demo', repoPath: 'C:/repos/demo', objective: 'Fix unit tests', testCommands: [{ name: 'unit', command: 'npm', args: ['test'] }] });
  const repair = synthesizeRepairTask({
    task,
    verification: { failed: ['unit'], failureClasses: ['TEST_FAILURE'], reason: 'unit failed' },
    evidence: { artifacts: { commitSha: 'deadbeef' } },
    attempt: 1
  });
  assert.equal(repair.state, 'READY');
  assert.equal(repair.metadata.execution.kind, 'coding-agent');
  assert.equal(repair.metadata.execution.ref, 'deadbeef');
  assert.match(repair.metadata.execution.branchBase, /repair-1$/);
  assert.equal(repair.metadata.execution.autoPush, true);
  assert.equal(repair.metadata.repairOf, 'issue-124');
});

test('throughput governor doubles healthy baseline but contracts on backpressure', () => {
  const governor = new ThroughputGovernor({ baselineConcurrency: 2, targetMultiplier: 2, maxConcurrency: 8, maxVerifierBacklog: 2, maxFailureRate: 0.2 });
  const healthy = governor.target({ availableCapacity: 8, verifierBacklog: 0, recentAccepted: 10, recentFailed: 1 });
  assert.equal(healthy.desiredConcurrency, 4);
  assert.equal(healthy.allowedConcurrency, 4);
  assert.equal(healthy.throttled, false);

  const backedUp = governor.target({ availableCapacity: 8, verifierBacklog: 5, recentAccepted: 10, recentFailed: 1 });
  assert.equal(backedUp.allowedConcurrency, 2);
  assert.equal(backedUp.reasons.includes('verifier-backlog'), true);

  const failing = governor.target({ availableCapacity: 8, verifierBacklog: 0, recentAccepted: 2, recentFailed: 2 });
  assert.equal(failing.allowedConcurrency, 2);
  assert.equal(failing.reasons.includes('failure-rate'), true);
});

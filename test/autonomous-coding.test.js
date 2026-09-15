import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCodingTask, fabricTaskFromDispatch } from '../src/agents/coding-task.js';
import { ThroughputGovernor } from '../src/scheduler/throughput-governor.js';
import { synthesizeRepairTask } from '../src/verification/evidence-bundle.js';

test('coding task compiler produces bounded generation-scoped fabric payload with routed model', () => {
  const task = compileCodingTask({
    key: 'issue-123', repository: 'Maxxed-Technical-Systems/demo', repoPath: 'C:/repos/demo',
    objective: 'Fix the failing validation', testCommands: [{ name: 'unit', command: 'npm', args: ['test'] }]
  });
  assert.equal(task.state, 'READY');
  assert.deepEqual(task.requirements.capabilities, ['coding-agent', 'git', 'node']);
  assert.deepEqual(task.metadata.modelRequest.capabilities, ['coding']);
  assert.equal(task.metadata.execution.kind, 'coding-agent');
  assert.equal(task.metadata.execution.branchBase, 'maxxed/agent/issue-123');
  assert.equal(task.metadata.execution.autoCommit, true);
  assert.equal(task.metadata.execution.autoPush, true);

  const dispatch = {
    workerId: 'worker-1',
    claim: { taskKey: task.key, ownerId: 'worker-1', claimId: 'claim-1', generation: 3 },
    modelSelection: { model: { id: 'coder-1', endpoint: 'http://model-host:8080' } }
  };
  const fabric = fabricTaskFromDispatch(task, dispatch);
  assert.equal(fabric.taskId, 'claim-1');
  assert.equal(fabric.preferredWorkerId, 'worker-1');
  assert.equal(fabric.payload.controlPlaneTaskKey, 'issue-123');
  assert.equal(fabric.payload.branchName, 'maxxed/agent/issue-123-g3');
  assert.equal(fabric.payload.model, 'coder-1');
  assert.equal(fabric.payload.modelEndpoint, 'http://model-host:8080');
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
  // Repair carries the parent's routing request forward, but stamps its attempt count as
  // lowerTierAttempts so the router's cost-justification gate can react to repeated failures
  // (issue #72 live wiring) -- at attempt 1 the cognition class itself is unchanged.
  assert.equal(repair.metadata.modelRequest.cognitionClass, task.metadata.modelRequest.cognitionClass);
  assert.equal(repair.metadata.modelRequest.lowerTierAttempts, 1);
});

test('throughput governor doubles healthy baseline but contracts on backpressure', () => {
  const governor = new ThroughputGovernor({ baselineConcurrency: 2, targetMultiplier: 2, maxConcurrency: 8, maxVerifierBacklog: 2, maxFailureRate: 0.2 });
  const healthy = governor.target({ availableCapacity: 8, verifierBacklog: 0, recentAccepted: 10, recentFailed: 1 });
  assert.equal(healthy.desiredConcurrency, 4);
  assert.equal(healthy.allowedConcurrency, 4);
  assert.equal(healthy.throttled, false);

  const backedUp = governor.target({ availableCapacity: 8, verifierBacklog: 5, recentAccepted: 10, recentFailed: 1 });
  // Verifier backlog closes implementation admission (see stage-aware-backpressure.test.js)
  // rather than shrinking overall allowed concurrency, so verification/repair lanes keep full
  // capacity to drain the backlog.
  assert.equal(backedUp.allowedConcurrency, 4);
  assert.equal(backedUp.implementationAdmissionOpen, false);
  assert.equal(backedUp.reasons.includes('verifier-backlog'), true);

  const failing = governor.target({ availableCapacity: 8, verifierBacklog: 0, recentAccepted: 2, recentFailed: 2 });
  assert.equal(failing.allowedConcurrency, 2);
  assert.equal(failing.reasons.includes('failure-rate'), true);
});

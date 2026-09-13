import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { ThroughputGovernor } from '../src/scheduler/throughput-governor.js';
import { TaskStage, taskStage } from '../src/scheduler/task-stage.js';
import { compileCodingTask } from '../src/agents/coding-task.js';
import { compileValidationTask } from '../src/agents/validation-task.js';
import { synthesizeRepairTask } from '../src/verification/evidence-bundle.js';

function worker(workerId, capabilities, freeSlots = 4) {
  return { workerId, capabilities, capacity: { freeSlots, freeMemoryMb: 16384 }, pressure: { cpuPct: 10, memoryPct: 20 }, metadata: { os: 'linux', arch: 'x64' } };
}

test('task compilers stamp canonical stages and legacy inference remains compatible', () => {
  const coding = compileCodingTask({ key: 'impl', repository: 'o/r', objective: 'implement', testCommands: [] });
  const validation = compileValidationTask({ key: 'verify', repository: 'o/r', ref: 'a'.repeat(40), steps: [{ command: 'node', args: ['--test'] }] });
  const repair = synthesizeRepairTask({ task: coding, verification: { failed: ['unit'], failureClasses: ['TEST_FAILURE'], reason: 'failed' }, attempt: 1 });
  assert.equal(taskStage(coding), TaskStage.IMPLEMENTATION);
  assert.equal(taskStage(validation), TaskStage.VERIFICATION);
  assert.equal(taskStage(repair), TaskStage.REPAIR);
  assert.equal(taskStage({ taskClass: 'validation' }), TaskStage.VERIFICATION);
  assert.equal(taskStage({ taskClass: 'repair', metadata: { repairOf: 'x' } }), TaskStage.REPAIR);
});

test('verification congestion closes implementation admission without shrinking downstream capacity', () => {
  const governor = new ThroughputGovernor({ baselineConcurrency: 2, targetMultiplier: 4, maxConcurrency: 8, maxVerifierBacklog: 2 });
  const decision = governor.target({ availableCapacity: 8, verifierBacklog: 3, recentAccepted: 20, recentFailed: 0, degraded: false });
  assert.deepEqual(decision.blockedStages, [TaskStage.IMPLEMENTATION]);
  assert.equal(decision.allowedConcurrency, 8);
  assert.equal(decision.implementationAdmissionOpen, false);
  assert.equal(decision.reasons.includes('verifier-backlog'), true);
});

test('scheduler holds implementation while verification and repair lanes continue draining', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'impl', repository: 'impl-repo', metadata: { priority: 100, stage: TaskStage.IMPLEMENTATION } });
  graph.add({ key: 'verify', repository: 'verify-repo', taskClass: 'validation', metadata: { priority: 10, stage: TaskStage.VERIFICATION } });
  graph.add({ key: 'repair', repository: 'repair-repo', taskClass: 'repair', metadata: { priority: 5, stage: TaskStage.REPAIR, repairOf: 'parent' } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 4, totalLaneLimit: 8 });
  const report = scheduler.planWithReport([worker('w1', [], 4)], {
    now: 1000,
    admissionDecision: { blockedStages: [TaskStage.IMPLEMENTATION] }
  });
  assert.deepEqual(report.dispatches.map((entry) => entry.taskKey).sort(), ['repair', 'verify']);
  const held = report.backpressure.find((entry) => entry.taskKey === 'impl');
  assert.equal(held.reason, 'stage-admission-closed');
  assert.equal(held.stage, TaskStage.IMPLEMENTATION);
});

test('global safety degradation may still contract total concurrency across every stage', () => {
  const governor = new ThroughputGovernor({ baselineConcurrency: 2, targetMultiplier: 4, maxConcurrency: 8, maxVerifierBacklog: 2 });
  const decision = governor.target({ availableCapacity: 8, verifierBacklog: 0, recentAccepted: 10, recentFailed: 0, degraded: true });
  assert.equal(decision.allowedConcurrency, 2);
  assert.deepEqual(decision.blockedStages, []);
  assert.equal(decision.reasons.includes('runtime-degraded'), true);
});

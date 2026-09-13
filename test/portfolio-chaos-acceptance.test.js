import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';

function worker(id, slots = 1) {
  return { workerId: id, state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: slots, freeMemoryMb: 8192 }, pressure: { cpuPct: 0, memoryPct: 0 } };
}

function packet(memberTaskIds = ['repo#1', 'repo#2']) {
  return {
    schema: 'maxxed.work-packet-contract.v1', formed: true,
    packetKey: 'packet-repo-1_repo-2', repository: 'repo', scope: 'scheduler',
    memberTaskIds, dependencies: [], riskClass: 'standard', baseCommit: 'base123', branch: 'packet/repo-1-2',
    validationTiers: { perTask: 'local', checkpoint: 'remote-at-final-integration' },
    rollbackStrategy: { baseCommit: 'base123', finalCommit: null, memberTaskIds }
  };
}

function runtime(graph, claims = new ClaimAuthority()) {
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 8, totalLaneLimit: 8 });
  return { claims, scheduler, orchestrator: new EngineeringOrchestrator({ graph, claims, scheduler, verifier: new AcceptanceVerifier(), repairs: new RepairController() }) };
}

test('overlapping bounded mutation scopes never double-run while disjoint work continues', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'repo', metadata: { priority: 10, mutationScopes: ['src/shared'] } });
  graph.add({ key: 'b', repository: 'repo', metadata: { priority: 9, mutationScopes: ['src/shared'] } });
  graph.add({ key: 'c', repository: 'repo', metadata: { priority: 8, mutationScopes: ['src/independent'] } });
  const { orchestrator } = runtime(graph);
  const dispatches = orchestrator.dispatch([worker('w1'), worker('w2'), worker('w3')], { now: 100 });
  assert.equal(dispatches.some((row) => row.taskKey === 'a'), true);
  assert.equal(dispatches.some((row) => row.taskKey === 'b'), false);
  assert.equal(dispatches.some((row) => row.taskKey === 'c'), true);
});

test('expired packet claim releases the packet scope and advances fencing before next member runs', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'repo#1', repository: 'repo', metadata: { priority: 10, workPacket: packet() } });
  graph.add({ key: 'repo#2', repository: 'repo', metadata: { priority: 9, workPacket: packet() } });
  const { orchestrator, claims } = runtime(graph);
  const first = orchestrator.dispatch([worker('w1')], { now: 100 });
  assert.equal(first.length, 1);
  const oldClaim = first[0].claim;
  const recovered = orchestrator.recoverExpired(30_101);
  assert.equal(recovered.length, 1);
  assert.equal(claims.validate(oldClaim, 30_101), false);
  graph.setState('repo#1', TaskState.BLOCKED, { reason: 'hold first packet member after simulated host loss' });
  const second = orchestrator.dispatch([worker('w2')], { now: 30_102 });
  assert.equal(second.length, 1);
  assert.equal(second[0].taskKey, 'repo#2');
  assert.ok(second[0].claim.generation >= 1);
});

test('stale fenced attempt cannot reclaim or validate after replacement generation exists', () => {
  const claims = new ClaimAuthority();
  const first = claims.claim({ taskKey: 't', ownerId: 'w1', scopes: ['repo:r:x'], ttlMs: 10 }, 100);
  assert.ok(first);
  claims.sweepExpired(110);
  const replacement = claims.claim({ taskKey: 't', ownerId: 'w2', scopes: ['repo:r:x'] }, 111);
  assert.ok(replacement);
  assert.ok(replacement.generation > first.generation);
  assert.equal(claims.validate(first, 111), false);
  assert.equal(claims.validate(replacement, 111), true);
});

test('active deployment blocks only deployment while verification drains', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'deploy-new', repository: 'b', taskClass: 'deployment', metadata: { priority: 10 } });
  graph.add({ key: 'verify', repository: 'c', taskClass: 'validation', metadata: { priority: 9 } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 8, totalLaneLimit: 8 });
  const report = scheduler.planWithReport([worker('w2'), worker('w3')], {
    now: 100,
    activeClaims: [{ taskKey: 'deploy-existing', repository: 'a', workerId: 'w1', stage: 'DEPLOYMENT' }]
  });
  assert.equal(report.dispatches.some((row) => row.taskKey === 'deploy-new'), false);
  assert.equal(report.dispatches.some((row) => row.taskKey === 'verify'), true);
  assert.equal(report.backpressure.find((row) => row.taskKey === 'deploy-new').reason, 'deployment-serialized');
});

test('packet blockage in one repository does not stall independent repository lanes', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'repo#2', repository: 'repo', metadata: { priority: 10, workPacket: packet() } });
  graph.add({ key: 'other#1', repository: 'other', metadata: { priority: 5, mutationScopes: ['src/x'] } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 8, totalLaneLimit: 8 });
  const report = scheduler.planWithReport([worker('w2')], {
    now: 100,
    activeClaims: [{ taskKey: 'repo#1', repository: 'repo', workerId: 'w1', packetKey: 'packet-repo-1_repo-2' }]
  });
  assert.equal(report.dispatches.some((row) => row.taskKey === 'repo#2'), false);
  assert.equal(report.dispatches.some((row) => row.taskKey === 'other#1'), true);
  assert.equal(report.backpressure.find((row) => row.taskKey === 'repo#2').reason, 'work-packet-active');
});

test('verification congestion blocks implementation admission while verification and repair remain eligible', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'impl', repository: 'a', taskClass: 'coding-agent', metadata: { priority: 10 } });
  graph.add({ key: 'verify', repository: 'b', taskClass: 'validation', metadata: { priority: 9 } });
  graph.add({ key: 'repair', repository: 'c', taskClass: 'repair', metadata: { priority: 8 } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 8, totalLaneLimit: 8 });
  const report = scheduler.planWithReport([worker('w1'), worker('w2'), worker('w3')], { now: 100, admissionDecision: { blockedStages: ['IMPLEMENTATION'] } });
  assert.equal(report.dispatches.some((row) => row.taskKey === 'impl'), false);
  assert.equal(report.dispatches.some((row) => row.taskKey === 'verify'), true);
  assert.equal(report.dispatches.some((row) => row.taskKey === 'repair'), true);
  assert.equal(report.backpressure.find((row) => row.taskKey === 'impl').reason, 'stage-admission-closed');
});

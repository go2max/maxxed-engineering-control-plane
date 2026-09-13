import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { workPacketView } from '../src/scheduler/work-packet-adapter.js';

function worker(workerId) {
  return { workerId, state: 'AVAILABLE', capabilities: [], capacity: { freeSlots: 1, freeMemoryMb: 8192 }, pressure: { cpuPct: 0, memoryPct: 0 } };
}

function packet(memberTaskIds = ['repo#1', 'repo#2']) {
  return {
    schema: 'maxxed.work-packet-contract.v1',
    formed: true,
    packetKey: 'packet-repo-1_repo-2',
    repository: 'repo',
    scope: 'scheduler',
    memberTaskIds,
    dependencies: [],
    riskClass: 'standard',
    baseCommit: 'base123',
    branch: 'packet/repo-1-2',
    validationTiers: { perTask: 'local', checkpoint: 'remote-at-final-integration' },
    rollbackStrategy: { baseCommit: 'base123', finalCommit: null, memberTaskIds }
  };
}

test('control plane consumes the canonical v1 packet envelope without recalculating eligibility', () => {
  const task = { key: 'repo#1', repository: 'repo', metadata: { workPacket: packet() } };
  const view = workPacketView(task);
  assert.equal(view.valid, true);
  assert.equal(view.packetKey, 'packet-repo-1_repo-2');
  assert.equal(view.contract.branch, 'packet/repo-1-2');
  assert.equal(view.contract.baseCommit, 'base123');
});

test('malformed or mismatched packet metadata fails closed', () => {
  assert.equal(workPacketView({ key: 'repo#1', repository: 'repo', metadata: { workPacket: { ...packet(), schema: 'wrong' } } }).valid, false);
  assert.equal(workPacketView({ key: 'repo#3', repository: 'repo', metadata: { workPacket: packet() } }).valid, false);
  assert.equal(workPacketView({ key: 'repo#1', repository: 'other', metadata: { workPacket: packet() } }).valid, false);
});

test('scheduler permits only one active mutation lane for members of the same packet', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'repo#1', repository: 'repo', metadata: { priority: 10, workPacket: packet() } });
  graph.add({ key: 'repo#2', repository: 'repo', metadata: { priority: 9, workPacket: packet() } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 4, totalLaneLimit: 4 });
  const report = scheduler.planWithReport([worker('w1'), worker('w2')], { now: 100 });
  assert.equal(report.dispatches.length, 1);
  assert.equal(report.dispatches[0].workPacket.packetKey, 'packet-repo-1_repo-2');
  assert.equal(report.backpressure.find((row) => row.taskKey === 'repo#2').reason, 'work-packet-active');
});

test('packet scope prevents a second claim even if scheduler admission is bypassed', () => {
  const claims = new ClaimAuthority();
  const first = claims.claim({ taskKey: 'repo#1', ownerId: 'w1', scopes: ['repo:repo', 'packet:packet-repo-1_repo-2'] }, 0);
  const second = claims.claim({ taskKey: 'repo#2', ownerId: 'w2', scopes: ['repo:repo', 'packet:packet-repo-1_repo-2'] }, 0);
  assert.ok(first);
  assert.equal(second, null);
});

test('explicit disjoint mutation scopes unlock safe same-repository parallelism', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'repo', metadata: { mutationScopes: ['src/a'] } });
  graph.add({ key: 'b', repository: 'repo', metadata: { mutationScopes: ['src/b'] } });
  const claims = new ClaimAuthority();
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 4, totalLaneLimit: 4 });
  const orchestrator = new EngineeringOrchestrator({ graph, scheduler, claims, verifier: new AcceptanceVerifier(), repairs: new RepairController() });
  const dispatches = orchestrator.dispatch([worker('w1'), worker('w2')], { now: 100 });
  assert.equal(dispatches.length, 2);
  assert.deepEqual(claims.list(100).map((claim) => claim.scopes).sort(), [['repo:repo:src/a'], ['repo:repo:src/b']]);
});

test('tasks without explicit mutation scopes retain whole-repository fail-safe locking', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'a', repository: 'repo' });
  graph.add({ key: 'b', repository: 'repo' });
  const claims = new ClaimAuthority();
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 4, totalLaneLimit: 4 });
  const orchestrator = new EngineeringOrchestrator({ graph, scheduler, claims, verifier: new AcceptanceVerifier(), repairs: new RepairController() });
  const dispatches = orchestrator.dispatch([worker('w1'), worker('w2')], { now: 100 });
  assert.equal(dispatches.length, 1);
  assert.deepEqual(claims.list(100)[0].scopes, ['repo:repo']);
});

test('deployment work is globally serialized while non-deployment lanes remain independent', () => {
  const graph = new TaskGraph();
  graph.add({ key: 'deploy-a', repository: 'a', taskClass: 'deployment', metadata: { priority: 10 } });
  graph.add({ key: 'deploy-b', repository: 'b', taskClass: 'deployment', metadata: { priority: 9 } });
  graph.add({ key: 'verify', repository: 'c', taskClass: 'validation', metadata: { priority: 8 } });
  const scheduler = new PortfolioScheduler({ graph, repoLaneLimit: 4, totalLaneLimit: 4 });
  const report = scheduler.planWithReport([worker('w1'), worker('w2'), worker('w3')], { now: 100 });
  assert.equal(report.dispatches.filter((row) => row.explanation.stage === 'DEPLOYMENT').length, 1);
  assert.equal(report.dispatches.some((row) => row.taskKey === 'verify'), true);
  assert.equal(report.backpressure.some((row) => row.reason === 'deployment-serialized'), true);
});

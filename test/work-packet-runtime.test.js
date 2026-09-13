import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
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

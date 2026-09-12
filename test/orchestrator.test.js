import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';

function create() {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  return { graph, claims, orchestrator: new EngineeringOrchestrator({ graph, claims, scheduler: new PortfolioScheduler({ graph }), verifier: new AcceptanceVerifier(), repairs: new RepairController() }) };
}

const worker = { workerId: 'w1', capabilities: ['node'], capacity: { freeSlots: 2, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

test('dispatch creates authoritative claim and marks task claimed', () => {
  const { graph, claims, orchestrator } = create();
  graph.add({ key: 't1', repository: 'go2max/demo', requirements: { capabilities: ['node'] } });
  const dispatched = orchestrator.dispatch([worker], { now: 1000 });
  assert.equal(dispatched.length, 1);
  assert.equal(graph.get('t1').state, TaskState.CLAIMED);
  assert.equal(claims.validate(dispatched[0].claim, 1001), true);
});

test('passing verification accepts task and releases claim', () => {
  const { graph, claims, orchestrator } = create();
  graph.add({ key: 't1', repository: 'go2max/demo' });
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  const completed = orchestrator.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { checks: { tests: { ok: true } } }, now: 1001 });
  assert.equal(completed.task.state, TaskState.ACCEPTED);
  assert.equal(claims.list().length, 0);
});

test('expired restartable claim returns task to frontier', () => {
  const { graph, claims, orchestrator } = create();
  graph.add({ key: 't1', repository: 'go2max/demo', metadata: { restartable: true } });
  const claim = claims.claim({ taskKey: 't1', ownerId: 'w1', scopes: ['repo:go2max/demo'], ttlMs: 10 }, 1000);
  graph.setState('t1', TaskState.CLAIMED);
  const expired = orchestrator.recoverExpired(1010);
  assert.equal(expired.length, 1);
  assert.equal(graph.get('t1').state, TaskState.READY);
  assert.equal(claims.validate(claim, 1011), false);
});

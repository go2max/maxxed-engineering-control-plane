// Covers issue #72's live wiring: compileCodingTask must infer a cognitionClass for real
// coding/repair work, and EngineeringOrchestrator#dispatch must actually route that request
// through ModelRouter.route() so tiered escalation and cost-justification gating govern real
// task dispatch -- not just the standalone router unit tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { ClaimAuthority } from '../src/core/claim-authority.js';
import { PortfolioScheduler } from '../src/scheduler/portfolio-scheduler.js';
import { AcceptanceVerifier } from '../src/verification/verifier.js';
import { RepairController } from '../src/verification/repair-controller.js';
import { EngineeringOrchestrator } from '../src/core/orchestrator.js';
import { ModelRegistry } from '../src/models/model-registry.js';
import { ModelRouter } from '../src/models/model-router.js';
import { CognitionClass, EscalationTier } from '../src/models/cognition-classes.js';
import { compileCodingTask } from '../src/agents/coding-task.js';
import { synthesizeRepairTask } from '../src/verification/evidence-bundle.js';

const worker = { workerId: 'w1', capabilities: ['coding-agent', 'git', 'node'], capacity: { freeSlots: 2, freeMemoryMb: 8192 }, pressure: { cpuPct: 10 }, metadata: { os: 'linux', arch: 'x64' } };

function createRuntime({ registerFrontier = false } = {}) {
  const graph = new TaskGraph();
  const claims = new ClaimAuthority();
  const registry = new ModelRegistry();
  registry.register({ id: 'cheap-local', kind: 'local', capabilities: ['coding'], contextWindow: 16000, tier: EscalationTier.CHEAP_MODEL, endpoint: 'http://cheap:8080' });
  registry.register({ id: 'strong-local', kind: 'local', capabilities: ['coding'], contextWindow: 32000, tier: EscalationTier.STRONG_MODEL, endpoint: 'http://strong:8080' });
  if (registerFrontier) registry.register({ id: 'frontier-local', kind: 'local', capabilities: ['coding'], contextWindow: 64000, tier: EscalationTier.FRONTIER, endpoint: 'http://frontier:8080' });
  const modelRouter = new ModelRouter({ registry, allowExternalEscalation: false });
  const orchestrator = new EngineeringOrchestrator({ graph, claims, scheduler: new PortfolioScheduler({ graph }), verifier: new AcceptanceVerifier(), repairs: new RepairController(), modelRouter });
  return { graph, claims, orchestrator, registry };
}

test('compileCodingTask infers cognitionClass by riskClass so real tasks carry live routing requests', () => {
  const normal = compileCodingTask({ key: 't-normal', repository: 'go2max/demo', objective: 'small fix' });
  assert.equal(normal.metadata.modelRequest.cognitionClass, CognitionClass.ROUTINE_CODING);

  const high = compileCodingTask({ key: 't-high', repository: 'go2max/demo', objective: 'risky change', riskClass: 'high' });
  assert.equal(high.metadata.modelRequest.cognitionClass, CognitionClass.SPECIALIST_REASONING);

  const critical = compileCodingTask({ key: 't-critical', repository: 'go2max/demo', objective: 'architectural change', riskClass: 'critical' });
  assert.equal(critical.metadata.modelRequest.cognitionClass, CognitionClass.FRONTIER_REASONING);
  assert.ok(critical.metadata.modelRequest.costJustification);
});

test('live dispatch path routes routine coding work to the cheapest eligible tier (regression: local-first/cheapest-correct unchanged)', () => {
  const { graph, orchestrator } = createRuntime({ registerFrontier: true });
  const task = compileCodingTask({ key: 't1', repository: 'go2max/demo', objective: 'routine fix' });
  graph.add(task);
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  assert.ok(dispatch, 'routine task should dispatch');
  assert.equal(dispatch.modelSelection.model.id, 'cheap-local');
  assert.equal(dispatch.modelSelection.explanation.selectedTier, EscalationTier.CHEAP_MODEL);
  assert.equal(graph.get('t1').state, TaskState.CLAIMED);
});

test('live dispatch path escalates a high-risk task to the strong-model tier via ModelRouter.route()', () => {
  const { graph, orchestrator } = createRuntime({ registerFrontier: true });
  const task = compileCodingTask({ key: 't2', repository: 'go2max/demo', objective: 'high risk change', riskClass: 'high' });
  graph.add(task);
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  assert.ok(dispatch, 'high-risk task should dispatch');
  assert.equal(dispatch.modelSelection.model.id, 'strong-local');
  assert.equal(dispatch.modelSelection.explanation.selectedTier, EscalationTier.STRONG_MODEL);
});

test('live dispatch path refuses frontier tier without cost justification: no frontier model configured blocks the task', () => {
  const { graph, orchestrator } = createRuntime({ registerFrontier: false });
  const task = compileCodingTask({ key: 't3', repository: 'go2max/demo', objective: 'architectural rewrite', riskClass: 'critical' });
  graph.add(task);
  const dispatched = orchestrator.dispatch([worker], { now: 1000 });
  assert.equal(dispatched.length, 0);
  assert.equal(graph.get('t3').state, TaskState.BLOCKED);
  assert.equal(graph.get('t3').lineage.at(-1).evidence.reason, 'no eligible model');
});

test('live dispatch path escalates repeated repair failures toward frontier once lower tiers are exhausted', () => {
  const { graph, orchestrator } = createRuntime({ registerFrontier: true });
  const task = compileCodingTask({ key: 't4', repository: 'go2max/demo', objective: 'flaky fix' });
  const repair = synthesizeRepairTask({
    task,
    verification: { failed: ['unit'], failureClasses: ['TEST_FAILURE'], reason: 'unit failed' },
    evidence: { artifacts: { commitSha: 'deadbeef' } },
    attempt: 4
  });
  assert.equal(repair.metadata.modelRequest.cognitionClass, CognitionClass.FRONTIER_REASONING);
  assert.equal(repair.metadata.modelRequest.lowerTierAttempts, 4);
  assert.ok(repair.metadata.modelRequest.costJustification);

  graph.add(repair);
  const [dispatch] = orchestrator.dispatch([worker], { now: 1000 });
  assert.ok(dispatch, 'repeatedly-failed repair should be justified to reach frontier');
  assert.equal(dispatch.modelSelection.model.id, 'frontier-local');
  assert.equal(dispatch.modelSelection.explanation.costJustified, true);
});

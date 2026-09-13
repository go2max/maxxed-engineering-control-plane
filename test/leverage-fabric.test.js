import test from 'node:test';
import assert from 'node:assert/strict';
import { SolutionCAS, solutionKey } from '../src/leverage/solution-cas.js';
import { ArtifactCache } from '../src/leverage/artifact-cache.js';
import { SemanticCodeGraph } from '../src/leverage/semantic-code-graph.js';
import { TransformRegistry, replaceTextTransform } from '../src/leverage/transform-registry.js';
import { TrajectoryHarvester } from '../src/leverage/trajectory-harvester.js';
import { RepairMemory } from '../src/leverage/repair-memory.js';
import { LeverageEngine, LeverageStrategy } from '../src/leverage/leverage-engine.js';
import { ProductFamilyPlanner } from '../src/leverage/product-family-planner.js';
import { BottleneckOptimizer } from '../src/leverage/bottleneck-optimizer.js';
import { MaintenancePlanner } from '../src/leverage/maintenance-planner.js';
import { defaultControlPlaneReplayProjector } from '../src/leverage/execution-replay.js';
import { SourceIndexer } from '../src/leverage/source-indexer.js';
import { ContextCompiler } from '../src/leverage/context-compiler.js';
import { SpeculativePlanner } from '../src/leverage/speculative-planner.js';
import { LeverageRuntimeAdapter } from '../src/leverage/runtime-adapter.js';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { compileCodingTask } from '../src/agents/coding-task.js';

test('solution CAS is canonical and reusable', () => {
  const a = solutionKey({ taskClass: 'x', normalizedSpec: { b: 2, a: 1 } });
  const b = solutionKey({ normalizedSpec: { a: 1, b: 2 }, taskClass: 'x' });
  assert.equal(a, b);
  const cas = new SolutionCAS();
  cas.put(a, { commitSha: 'abc' }, { tags: ['x'] });
  assert.equal(cas.get(a).result.commitSha, 'abc');
  assert.equal(cas.findByTag(['x']).length, 1);
});

test('artifact cache expires and invalidates by tag', () => {
  const cache = new ArtifactCache();
  const input = { kind: 'tests', inputs: { sha: 'abc' } };
  cache.put(input, { passed: true }, { tags: ['repo:a'], ttlMs: 10, now: 100 });
  assert.equal(cache.get(input, 105).artifact.passed, true);
  assert.equal(cache.get(input, 111), null);
  cache.put(input, { passed: true }, { tags: ['repo:a'], now: 200 });
  assert.equal(cache.invalidateTags(['repo:a']), 1);
});

test('semantic graph produces bounded dependency slices', () => {
  const graph = new SemanticCodeGraph();
  for (const id of ['a','b','c','d']) graph.upsertNode({ id, kind: 'symbol' });
  graph.addEdge({ from: 'a', to: 'b', type: 'calls' });
  graph.addEdge({ from: 'b', to: 'c', type: 'imports' });
  graph.addEdge({ from: 'c', to: 'd', type: 'tests' });
  const slice = graph.dependencySlice(['a'], { depth: 2 });
  assert.deepEqual(new Set(slice.nodes.map((n) => n.id)), new Set(['a','b','c']));
});

test('source indexer creates file, symbol and import graph', () => {
  const graph = new SemanticCodeGraph();
  const indexer = new SourceIndexer({ graph });
  const result = indexer.index({ repository: 'o/r', files: [
    { path: 'src/a.js', content: "import { b } from './b.js';\nexport function a(){ return b(); }" },
    { path: 'src/b.js', content: 'export function b(){ return 1; }' }
  ] });
  assert.equal(result.files, 2);
  assert.equal(result.symbols, 2);
  assert.equal([...graph.edges.values()].some((e) => e.type === 'imports'), true);
});

test('deterministic transform registry rewrites and verifies', async () => {
  const registry = new TransformRegistry();
  registry.register(replaceTextTransform({ id: 'rename', from: 'oldApi(', to: 'newApi(' }));
  const candidates = registry.candidates({ files: [{ path: 'a.js', content: 'oldApi();' }] });
  assert.equal(candidates[0].id, 'rename');
  const result = await registry.execute('rename', { files: [{ path: 'a.js', content: 'oldApi();' }] });
  assert.equal(result.result.files[0].content, 'newApi();');
  assert.ok(result.deterministicKey);
});

test('trajectory harvester redacts secrets and builds preference pairs', () => {
  const h = new TrajectoryHarvester();
  h.record({ task: { key: 'a', repository: 'r', objective: 'same' }, outcome: 'FAILED', evidence: { token: 'secret', reason: 'bad' } });
  h.record({ task: { key: 'b', repository: 'r', objective: 'same' }, outcome: 'ACCEPT', evidence: { commitSha: 'abc' } });
  assert.equal(h.records[0].evidence.token, '[REDACTED]');
  assert.equal(h.preferencePairs().length, 1);
  assert.equal(h.trainingRows({ acceptedOnly: true }).length, 1);
});

test('repair memory recalls accepted repairs', () => {
  const memory = new RepairMemory();
  memory.remember({ fingerprint: 'f1', repairPlan: { steps: ['fix'] }, commitSha: 'abc', accepted: true });
  assert.equal(memory.recall('f1')[0].commitSha, 'abc');
});

test('leverage engine prefers exact reuse then transform then retrieval then novel reasoning', () => {
  const cas = new SolutionCAS(); const graph = new SemanticCodeGraph(); const transforms = new TransformRegistry(); const repairs = new RepairMemory();
  const engine = new LeverageEngine({ cas, graph, transforms, repairs });
  const base = { taskClass: 'coding', normalizedSpec: { objective: 'x' } };
  assert.equal(engine.plan(base).strategy, LeverageStrategy.NOVEL_REASONING);
  cas.put({ ...base, dependencySlice: { seedIds: [], nodes: [], edges: [] }, environment: null, policyVersion: null }, { ok: true }, { tags: ['coding'] });
  assert.equal(engine.plan(base).strategy, LeverageStrategy.EXACT_REUSE);
  assert.notEqual(engine.plan({ ...base, exactReuseAllowed: false }).strategy, LeverageStrategy.EXACT_REUSE);

  const cas2 = new SolutionCAS(); const transforms2 = new TransformRegistry();
  transforms2.register(replaceTextTransform({ id: 't', from: 'old', to: 'new' }));
  const engine2 = new LeverageEngine({ cas: cas2, graph, transforms: transforms2, repairs });
  assert.equal(engine2.plan({ ...base, context: { files: [{ path: 'a', content: 'old' }] } }).strategy, LeverageStrategy.DETERMINISTIC_TRANSFORM);

  const cas3 = new SolutionCAS(); cas3.put('semantic', { accepted: true }, { tags: ['coding'], confidence: 0.9 });
  const engine3 = new LeverageEngine({ cas: cas3, graph, transforms: new TransformRegistry(), repairs });
  assert.equal(engine3.plan(base).strategy, LeverageStrategy.RETRIEVAL_ASSISTED);
});

test('product family planner emits only product delta', () => {
  const planner = new ProductFamilyPlanner();
  planner.registerBaseline({ family: 'saas', version: 1, features: { auth: true, billing: true, export: false }, policy: { region: 'us' } });
  const plan = planner.plan({ family: 'saas', productFeatures: { auth: true, billing: true, export: true }, productPolicy: { region: 'us' } });
  assert.deepEqual(Object.keys(plan.featureDelta), ['export']);
  assert.equal(plan.reuseRatio, 2 / 3);
});

test('maintenance planner batches portfolio transformations deterministically', () => {
  const planner = new MaintenancePlanner();
  const plan = planner.plan({ changeId: 'node22', transformId: 'runtime-upgrade', repositories: ['c','a','b'], batchSize: 2 });
  assert.equal(plan.batchCount, 2);
  assert.deepEqual(plan.batches[0].repositories, ['a','b']);
});

test('bottleneck optimizer identifies verification pressure', () => {
  const result = new BottleneckOptimizer().analyze({ workers: [{ capacity: { freeSlots: 10 }, pressure: { cpuPct: 10, memoryPct: 10 } }], verifierBacklog: 10, queueDepth: 4 });
  assert.equal(result.bottleneck, 'verification');
  assert.equal(result.recommendation, 'shift-capacity-to-verification');
});

test('execution replay reconstructs task state', () => {
  const projector = defaultControlPlaneReplayProjector();
  const state = projector.replay([
    { sequence: 1, type: 'task.ingested', payload: { taskKey: 'a' } },
    { sequence: 2, type: 'dispatch.issued', payload: { tasks: ['a'] } },
    { sequence: 3, type: 'task.completed', payload: { taskKey: 'a', action: 'ACCEPT', verdict: 'ACCEPT' } }
  ]);
  assert.equal(state.tasks.a.state, 'ACCEPT');
});

test('context compiler returns minimal graph slice and proven examples', () => {
  const graph = new SemanticCodeGraph(); graph.upsertNode({ id: 'a', kind: 'symbol', path: 'a.js' });
  const cas = new SolutionCAS(); cas.put('k', { patch: 'x' }, { tags: ['coding'], confidence: 1 });
  const context = new ContextCompiler({ graph, cas, repairs: new RepairMemory() }).compile({ taskClass: 'coding', objective: 'fix', dependencySeeds: ['a'] });
  assert.equal(context.stats.graphNodes, 1);
  assert.equal(context.stats.examples, 1);
});

test('speculative planner fans out only when value or novelty justifies it', () => {
  const planner = new SpeculativePlanner({ maxCandidates: 4 });
  assert.equal(planner.plan({ novelty: 0.1, availableSlots: 4, verifierCapacity: 4 }).candidates, 1);
  assert.equal(planner.plan({ novelty: 0.9, riskClass: 'high', expectedValue: 12, availableSlots: 4, verifierCapacity: 4 }).candidates, 4);
});

test('runtime adapter refuses exact reuse on mutable HEAD but reuses identical immutable source', () => {
  const runtime = new ControlPlaneRuntime(); const cas = new SolutionCAS(); const graph = new SemanticCodeGraph(); const repairs = new RepairMemory(); const harvester = new TrajectoryHarvester();
  const engine = new LeverageEngine({ cas, graph, transforms: new TransformRegistry(), repairs });
  const adapter = new LeverageRuntimeAdapter({ runtime, engine, cas, harvester, repairs });
  const repoSha = 'a'.repeat(40);

  const task = compileCodingTask({ key: 'repeat-1', repository: 'o/r', repoPath: '/repo', objective: 'same fix' });
  const immutableSpec = { repository: 'o/r', objective: 'same fix', acceptance: task.metadata.acceptance, execution: { baseBranch: 'main', ref: repoSha } };
  cas.put({ taskClass: task.taskClass, normalizedSpec: immutableSpec, dependencySlice: { seedIds: [], nodes: [], edges: [] }, environment: { repoSha, sourceFingerprint: repoSha }, policyVersion: '1' }, { artifacts: { commitSha: 'abc' } }, { tags: [task.taskClass] });

  const mutable = adapter.prepareCodingTask(task);
  assert.equal(mutable.reused, false);
  assert.notEqual(mutable.plan.strategy, LeverageStrategy.EXACT_REUSE);

  const task2 = compileCodingTask({ key: 'repeat-2', repository: 'o/r', repoPath: '/repo', objective: 'same fix', ref: repoSha });
  const prepared = adapter.prepareCodingTask(task2, { environment: { repoSha } });
  assert.equal(prepared.reused, true);
  assert.equal(runtime.graph.get('repeat-2').state, 'ACCEPTED');
});

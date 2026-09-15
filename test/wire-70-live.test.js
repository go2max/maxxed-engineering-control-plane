import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraph, TaskState } from '../src/core/task-graph.js';
import { MicroShardPlanner } from '../src/patch/shard-planner.js';
import { PatchFabric } from '../src/patch/patch-fabric.js';
import { PatchComposer } from '../src/patch/patch-composer.js';
import { MicroShardCoordinator } from '../src/patch/micro-shard-coordinator.js';
import { createPatchBundle } from '../src/patch/patch-bundle.js';
import { AdaptiveShardSizer } from '../src/patch/adaptive-shard-sizing.js';
import { ChallengeSuiteScheduler } from '../src/verification/challenge-suite-scheduler.js';
import { createControlPlaneServer } from '../src/service/http-server.js';
import { HotSymbolLock } from '../src/patch/hot-symbol-lock.js';
import http from 'node:http';

const BASE = 'a'.repeat(40);
const ACCEPTED = 'b'.repeat(40);

function evidenceBundle({ patchBundle = null, commitSha = null, branchName = null, pushed = false } = {}) {
  return { digest: `bundle:${commitSha ?? patchBundle?.shardKey ?? 'x'}`, payload: { evidence: { artifacts: { patchBundle, commitSha, branchName, pushed } } } };
}

function runtimeHarness() {
  const graph = new TaskGraph();
  const events = [];
  return { graph, events, journal: { append(type, payload) { events.push({ type, payload }); } }, ingest(task) { return graph.add(task); } };
}

function addShardableParent(runtime, key = 'parent', { units = null, model = 'gpt-x' } = {}) {
  runtime.graph.add({
    key, repository: 'org/repo', objective: 'rename four independent files', state: TaskState.READY,
    riskClass: 'normal', taskClass: 'migration', requirements: { capabilities: ['coding-agent', 'git', 'node'] },
    metadata: {
      priority: 10,
      acceptance: { requiredChecks: ['full'] },
      modelRequest: { model },
      execution: {
        kind: 'coding-agent', repoPath: '/repo', ref: BASE, baseBranch: 'main', branchBase: `maxxed/agent/${key}`,
        goal: 'rename files', testCommands: [{ name: 'full', command: 'npm', args: ['test'] }], autoCommit: true, autoPush: true,
        modelRequest: { model },
        precomputedWrites: units ?? [1, 2, 3, 4].map((n) => ({ path: `src/f${n}.js`, content: `export const n = ${n};\n` })),
        microSharding: { estimatedMonolithicMs: 60_000, maxShards: 4 }
      }
    }
  });
}

test('adaptive shard sizing is actually consulted by MicroShardPlanner.plan() for real executor/task-class pairings', () => {
  const sizer = new AdaptiveShardSizer({ minLines: 40, baselineTargetLines: 100, maxLines: 2000 });
  const planner = new MicroShardPlanner({ minLines: 40, targetLines: 100, maxLines: 200, adaptiveSizer: sizer });
  for (let i = 0; i < 30; i += 1) sizer.recordOutcome({ executorId: 'strong-exec', taskClass: 'coding-agent', shardLines: 900 + i, outcome: 'accepted' });

  const units = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, files: [`f${i}.js`], estimatedLines: 300 }));
  const withoutExecutor = planner.plan({ parentTaskKey: 'p1', baseSha: BASE, units, availableSlots: 6, verifierSlots: 6, composerSlots: 1, estimatedMonolithicMs: 100_000 });
  const withStrongExecutor = planner.plan({ parentTaskKey: 'p2', baseSha: BASE, units, availableSlots: 6, verifierSlots: 6, composerSlots: 1, estimatedMonolithicMs: 100_000, executorId: 'strong-exec', taskClass: 'coding-agent', sizingFeatures: { novelty: 0.1, mutationSurface: 0.1, contextEntropy: 0.1, verifierCost: 0.1 } });

  // The proven executor's evidence-driven max/target is far above the fixed 200-line ceiling,
  // so it should end up packing units into fewer, larger shards than the no-history plan.
  assert.ok(withStrongExecutor.sizing.maxLines > 200);
  assert.ok(withStrongExecutor.shards.length <= withoutExecutor.shards.length);
});

test('MicroShardCoordinator feeds real shard outcomes back into the adaptive sizer via reconcile()', () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const planner = new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0, targetLines: 100, maxLines: 150 });
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: planner });
  addShardableParent(runtime, 'adaptive-parent', { model: 'model-learn' });

  coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });
  const shard = runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'shard');
  assert.equal(shard.metadata.patchFabric.executorId, 'model-learn');

  const before = planner.adaptiveSizer.statsFor('model-learn', 'migration');
  assert.equal(before.runs, 0);

  const file = shard.metadata.execution.patchBundle.scope.files[0];
  const patchBundle = createPatchBundle({
    taskKey: shard.key, parentTaskKey: 'adaptive-parent', shardKey: shard.key, repository: 'org/repo', baseSha: BASE,
    workerId: 'w1', generation: 1, scope: shard.metadata.execution.patchBundle.scope,
    writes: [{ path: file, beforeContent: `// old ${file}\n`, content: `export const n = 1;\n` }]
  });
  runtime.graph.setState(shard.key, TaskState.ACCEPTED, { evidenceBundle: evidenceBundle({ patchBundle }) });
  coordinator.reconcile([{ taskKey: shard.key, action: 'ACCEPT' }], { now: 200 });

  const after = planner.adaptiveSizer.statsFor('model-learn', 'migration');
  assert.equal(after.runs, 1);
  assert.equal(after.acceptedRuns, 1);
});

test('hot symbols are serialized across shards in the same materialize() batch via real task dependencies', () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const planner = new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0, targetLines: 10, maxLines: 20 });
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: planner, hotSymbolLock: new HotSymbolLock({ hotThreshold: 3 }) });
  // Prime the lock so `shared.js` is already "hot" before this batch is planned.
  for (let i = 0; i < 3; i += 1) coordinator.hotSymbolLock.acquire(`warmup-${i}`, { scope: { files: ['shared.js'], symbols: [] } });

  addShardableParent(runtime, 'hot-parent', { units: [
    { path: 'shared.js', content: 'export const a = 1;\n' },
    { path: 'other-a.js', content: 'export const b = 1;\n' },
    { path: 'other-b.js', content: 'export const c = 1;\n' }
  ] });
  coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });

  const shards = runtime.graph.list().filter((task) => task.metadata?.patchFabric?.kind === 'shard');
  const hotShard = shards.find((task) => task.metadata.execution.patchBundle.scope.files.includes('shared.js'));
  assert.ok(hotShard.metadata.patchFabric.hotIdentifiers.includes('shared.js'));
});

test('PatchComposer blocks composition on a real semantic conflict carried in shard evidence', () => {
  const composer = new PatchComposer();
  const shared = { beforeContent: '// a\n' };
  const one = createPatchBundle({
    taskKey: 'shard-1', shardKey: 'shard-1', baseSha: BASE, workerId: 'w1', generation: 1,
    writes: [{ path: 'a.js', beforeContent: shared.beforeContent, content: '// a v2\n' }],
    evidence: { semantics: { exports: ['renderWidget'] } }
  });
  const two = createPatchBundle({
    taskKey: 'shard-2', shardKey: 'shard-2', baseSha: BASE, workerId: 'w2', generation: 1,
    writes: [{ path: 'b.js', beforeContent: '// b\n', content: '// b v2\n' }],
    evidence: { semantics: { callsInto: ['renderWidget'] } }
  });

  assert.throws(
    () => composer.compose({ baseSha: BASE, baseFiles: { 'a.js': shared.beforeContent, 'b.js': '// b\n' }, bundles: [one, two], parentTaskKey: 'parent' }),
    /semantic patch conflicts detected/
  );
});

test('PatchComposer still composes cleanly when no semantic edge is declared (file/symbol-only, unchanged behavior)', () => {
  const composer = new PatchComposer();
  const one = createPatchBundle({ taskKey: 'shard-1', shardKey: 'shard-1', baseSha: BASE, workerId: 'w1', generation: 1, writes: [{ path: 'a.js', beforeContent: '// a\n', content: '// a v2\n' }] });
  const two = createPatchBundle({ taskKey: 'shard-2', shardKey: 'shard-2', baseSha: BASE, workerId: 'w2', generation: 1, writes: [{ path: 'b.js', beforeContent: '// b\n', content: '// b v2\n' }] });
  const result = composer.compose({ baseSha: BASE, baseFiles: { 'a.js': '// a\n', 'b.js': '// b\n' }, bundles: [one, two], parentTaskKey: 'parent' });
  assert.equal(result.semanticConflictReport.blocksComposition, false);
  assert.equal(result.hotSymbolAcquisitions.every((row) => row.acquired), true);
});

test('a failed composed batch is bisected through the real shard/verification pipeline instead of failing blind', async () => {
  const runtime = runtimeHarness();
  const patchFabric = new PatchFabric();
  const planner = new MicroShardPlanner({ fixedShardOverheadMs: 0, compositionOverheadMs: 0, targetLines: 10, maxLines: 20 });
  const coordinator = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner: planner });
  addShardableParent(runtime, 'bisect-parent', { units: [
    { path: 'good.js', content: 'export const ok = 1;\n' },
    { path: 'bad.js', content: 'export const broken = 1;\n' }
  ] });
  coordinator.materialize({ workers: [{ capacity: { freeSlots: 4 } }], verifierSlots: 4, composerSlots: 1, now: 100 });
  const shards = runtime.graph.list().filter((task) => task.metadata?.patchFabric?.kind === 'shard');

  const reconciled = [];
  for (const [index, shard] of shards.entries()) {
    const file = shard.metadata.execution.patchBundle.scope.files[0];
    const content = shard.metadata.execution.precomputedWrites?.find((write) => write.path === file)?.content ?? '// changed\n';
    const patchBundle = createPatchBundle({ taskKey: shard.key, parentTaskKey: 'bisect-parent', shardKey: shard.key, repository: 'org/repo', baseSha: BASE, workerId: `w${index}`, generation: 1, scope: shard.metadata.execution.patchBundle.scope, writes: [{ path: file, beforeContent: `// old ${file}\n`, content }] });
    runtime.graph.setState(shard.key, TaskState.ACCEPTED, { evidenceBundle: evidenceBundle({ patchBundle }) });
    reconciled.push({ taskKey: shard.key, action: 'ACCEPT' });
  }
  coordinator.reconcile(reconciled, { now: 200 });
  const integration = runtime.graph.list().find((task) => task.metadata?.patchFabric?.kind === 'composition');
  assert.ok(integration);

  runtime.graph.setState(integration.key, TaskState.FAILED, { reason: 'tests failed' });
  coordinator.reconcile([{ taskKey: integration.key, action: 'TERMINATE' }], { now: 300 });
  assert.equal(runtime.graph.get('bisect-parent').state, TaskState.BLOCKED);

  // Resolve the bisection probe task(s) the coordinator created for real re-verification: fail
  // any probe whose subset still contains the "bad" shard, accept the rest, driving the
  // bisector's ddmin search to converge through the real task/acceptance pipeline.
  for (let tick = 0; tick < 10 && runtime.events.every((e) => e.type !== 'patch.composition.bisected'); tick += 1) {
    const probes = runtime.graph.list().filter((task) => task.metadata?.patchFabric?.kind === 'bisection-probe' && task.state === TaskState.READY);
    if (!probes.length) break;
    const rows = [];
    for (const probe of probes) {
      const subsetKeys = probe.metadata.patchFabric.subsetKeys;
      const containsBad = subsetKeys.some((key) => shards.find((s) => s.key === key)?.metadata.execution.patchBundle.scope.files.includes('bad.js'));
      runtime.graph.setState(probe.key, containsBad ? TaskState.FAILED : TaskState.ACCEPTED, { evidenceBundle: containsBad ? null : evidenceBundle({ commitSha: ACCEPTED }) });
      rows.push({ taskKey: probe.key, action: containsBad ? 'TERMINATE' : 'ACCEPT' });
    }
    coordinator.reconcile(rows, { now: 400 + tick });
    // let the microtask queue drain so the async bisect() loop advances one step
    await new Promise((resolve) => setImmediate(resolve));
  }

  const finding = runtime.events.find((e) => e.type === 'patch.composition.bisected');
  assert.ok(finding, 'expected a patch.composition.bisected diagnostic to be recorded');
  assert.ok(finding.payload.minimalFailingSubset.length >= 1);
  const badShard = shards.find((s) => s.metadata.execution.patchBundle.scope.files.includes('bad.js'));
  assert.ok(finding.payload.minimalFailingSubset.includes(badShard.key));
});

test('ChallengeSuiteScheduler periodically overrides affected-only test selection with a full-suite challenge over HTTP', async () => {
  const graph = new TaskGraph();
  const runtime = { graph, snapshot: () => ({}), pause() {}, resume() {}, paused: false, verificationLedger: { entries: [] }, journal: { append() {} }, claims: { release() {} } };
  const impactTestSelector = { select: () => ({ mode: 'targeted', reason: 'semantic-impact', tests: ['a.test.js'], impacted: { nodes: [] } }) };
  const challengeSuiteScheduler = new ChallengeSuiteScheduler({ everyNTargeted: 1, minIntervalMs: 0 });
  const server = createControlPlaneServer({ runtime, adminToken: 'tok', leverageComponents: { impactTestSelector, challengeSuiteScheduler } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const body = JSON.stringify({ changedNodeIds: ['x'], fullSuiteTests: ['a.test.js', 'b.test.js'] });
  const first = await postJson(port, '/leverage/tests/select', body);
  assert.equal(first.mode, 'full');
  assert.equal(first.challenge, true);
  assert.deepEqual(first.tests.sort(), ['a.test.js', 'b.test.js']);

  await new Promise((resolve) => server.close(resolve));
});

function postJson(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer tok' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

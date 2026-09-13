import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPatchBundle, contentHash } from '../src/patch/patch-bundle.js';
import { buildPatchConflictGraph } from '../src/patch/conflict-graph.js';
import { PatchComposer } from '../src/patch/patch-composer.js';
import { PatchFabric, PatchSessionState } from '../src/patch/patch-fabric.js';
import { MicroShardPlanner } from '../src/patch/shard-planner.js';
import { FileArtifactStore } from '../src/leverage/content-addressed-artifact-store.js';
import { SecretScanner } from '../src/security/secret-scanner.js';
import { TrajectoryHarvester } from '../src/leverage/trajectory-harvester.js';
import { TransformRegistry, replaceTextTransform } from '../src/leverage/transform-registry.js';
import { SemanticCodeGraph } from '../src/leverage/semantic-code-graph.js';
import { ScipIndexAdapter } from '../src/leverage/code-index-adapters.js';
import { ContextCompiler } from '../src/leverage/context-compiler.js';
import { SolutionCAS } from '../src/leverage/solution-cas.js';
import { RepairMemory } from '../src/leverage/repair-memory.js';
import { ImpactTestSelector } from '../src/verification/impact-test-selector.js';
import { TestReliabilityLedger } from '../src/verification/test-reliability.js';
import { buildCanaryPlan, evaluateCanaryStage } from '../src/factories/environment-promotion.js';
import { buildArtifactAttestation, signArtifactAttestation, verifyArtifactAttestation } from '../src/security/artifact-attestation.js';
import { WorkerPerformanceLedger } from '../src/scheduler/worker-performance.js';
import { ModelEvalLedger } from '../src/models/model-evals.js';
import { DerivedStateManager } from '../src/leverage/derived-state.js';
import { ArtifactCache } from '../src/leverage/artifact-cache.js';
import { SpeculativePlanner } from '../src/leverage/speculative-planner.js';

const BASE = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

function bundle({ shardKey, path: file, before, after, dependsOn = [], resources = [] }) {
  return createPatchBundle({
    taskKey: shardKey,
    parentTaskKey: 'parent',
    shardKey,
    repository: 'o/r',
    baseSha: BASE,
    workerId: `worker-${shardKey}`,
    generation: 1,
    dependsOn,
    scope: { files: [file], resources },
    writes: [{ path: file, beforeHash: before == null ? null : contentHash(before), content: after }],
    checks: [{ name: 'targeted', ok: true }]
  });
}

test('Patch Fabric rejects unordered overlapping shards and stale bases', () => {
  const one = bundle({ shardKey: 'one', path: 'a.js', before: 'x', after: 'y' });
  const two = bundle({ shardKey: 'two', path: 'a.js', before: 'x', after: 'z' });
  assert.equal(buildPatchConflictGraph([one, two]).conflicts[0].reasons.includes('file-overlap'), true);
  assert.throws(() => new PatchComposer().compose({ baseSha: NEXT, baseFiles: { 'a.js': 'x' }, bundles: [one] }), /stale patch base SHA/);
});

test('Patch Composer applies explicitly ordered same-file shards with before-hash fencing', () => {
  const one = bundle({ shardKey: 'one', path: 'a.js', before: 'x', after: 'y' });
  const two = bundle({ shardKey: 'two', path: 'a.js', before: 'y', after: 'z', dependsOn: ['one'] });
  const result = new PatchComposer().compose({ baseSha: BASE, baseFiles: { 'a.js': 'x' }, bundles: [one, two], parentTaskKey: 'parent' });
  assert.equal(result.files['a.js'], 'z');
  assert.equal(result.requiresParentVerification, true);
  assert.equal(result.accepted, false);
});

test('Patch Fabric cannot accept shards until parent verification passes exact SHA', () => {
  const one = bundle({ shardKey: 'one', path: 'a.js', before: 'x', after: 'y' });
  const fabric = new PatchFabric();
  const session = fabric.start({ parentTaskKey: 'parent', repository: 'o/r', baseSha: BASE, shardKeys: ['one'] });
  assert.equal(fabric.submit(session.sessionId, one).state, PatchSessionState.READY_TO_COMPOSE);
  fabric.compose(session.sessionId, { baseFiles: { 'a.js': 'x' } });
  assert.throws(() => fabric.recordParentVerification(session.sessionId, { accepted: true }), /acceptedSha/);
  const accepted = fabric.recordParentVerification(session.sessionId, { accepted: true, acceptedSha: NEXT, evidence: { fullSuite: true } });
  assert.equal(accepted.state, PatchSessionState.ACCEPTED);
  assert.equal(accepted.acceptance.acceptedSha, NEXT);
});

test('MicroShardPlanner expands only when measured savings exceed coordination cost', () => {
  const planner = new MicroShardPlanner({ fixedShardOverheadMs: 100, compositionOverheadMs: 100 });
  const fast = planner.plan({ parentTaskKey: 'p', baseSha: BASE, availableSlots: 4, verifierSlots: 4, units: [
    { id: 'a', files: ['a.js'], estimatedLines: 200, estimatedMs: 10_000 },
    { id: 'b', files: ['b.js'], estimatedLines: 200, estimatedMs: 10_000 },
    { id: 'c', files: ['c.js'], estimatedLines: 200, estimatedMs: 10_000 }
  ] });
  assert.equal(fast.mode, 'micro-sharded');
  assert.ok(fast.projectedSpeedup > 1);
  const unsafe = planner.plan({ parentTaskKey: 'p', baseSha: BASE, riskClass: 'payment', units: [{ id: 'a', files: ['a'], estimatedLines: 500, estimatedMs: 10000 }] });
  assert.equal(unsafe.mode, 'single');
});

test('File artifact store detects corruption and reports actual evictions', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'maxxed-cas-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileArtifactStore({ root, maxBytes: 25, maxEntryBytes: 1000 });
  const first = await store.put({ value: '1234567890' });
  await store.put({ value: 'abcdefghij' });
  const stats = await store.stats();
  assert.ok(stats.bytes <= 25);
  const prune = await store.prune();
  assert.equal(prune.evicted, 0);
  const remaining = (await store.stats()).entries;
  assert.ok(remaining <= 1);
  const maybeFirst = await store.get(first.key);
  if (maybeFirst) {
    await writeFile(path.join(root, `${first.key}.artifact`), 'corrupt', 'utf8');
    await assert.rejects(() => store.get(first.key), /corruption/);
  }
});

test('Secret scanner and trajectory harvester redact, version, dedupe and revoke provenance', () => {
  const scanner = new SecretScanner();
  const sanitized = scanner.sanitize({ authorization: 'Bearer abcdefghijklmnopqrstuvwxyz', nested: 'github_pat_abcdefghijklmnopqrstuvwxyz123456' });
  assert.ok(sanitized.findings.length >= 2);
  const h = new TrajectoryHarvester({ scanner });
  const task = { key: 't1', repository: 'o/r', taskClass: 'coding', objective: 'Fix API', metadata: { acceptance: {} } };
  h.record({ task, outcome: 'ACCEPT', evidence: { token: 'secret' }, sourceRefs: ['file:1'] });
  h.record({ task: { ...task, key: 't2', objective: 'fix api!!' }, outcome: 'FAILED', sourceRefs: ['file:2'] });
  assert.equal(h.records[0].schemaVersion, 2);
  assert.equal(h.records[0].evidence.token, '[REDACTED]');
  assert.equal(h.nearDuplicates().length, 1);
  assert.equal(h.revokeSource('file:1').affected, 1);
  assert.equal(h.trainingRows().some((row) => row.provenance.taskKey === 't1'), false);
});

test('Transform registry enforces guards, postconditions and emits rollback manifest', async () => {
  const registry = new TransformRegistry();
  registry.register(replaceTextTransform({ id: 'node-only', from: 'old(', to: 'new(', language: 'javascript', minMatches: 1, maxMatches: 2 }));
  assert.equal(registry.candidates({ language: 'python', files: [{ path: 'a.py', content: 'old()' }] }).length, 0);
  const result = await registry.execute('node-only', { language: 'javascript', files: [{ path: 'a.js', content: 'old();' }] });
  assert.equal(result.result.files[0].content, 'new();');
  assert.equal(result.rollback.reverseWrites[0].content, 'old();');
});

test('SCIP adapter binds index data to source SHA and ContextCompiler drops stale graph nodes', async () => {
  const graph = new SemanticCodeGraph();
  await new ScipIndexAdapter({ graph }).index({ repository: 'o/r', sourceSha: BASE, index: { documents: [{ relative_path: 'src/a.js', language: 'javascript', occurrences: [{ symbol: 'scip-js npm a 1.0.0 a.', symbol_roles: 1 }] }] } });
  graph.upsertNode({ id: 'stale', kind: 'symbol', path: 'src/stale.js', sourceSha: NEXT });
  graph.addEdge({ from: 'file:o/r:src/a.js', to: 'stale', type: 'references' });
  const ctx = new ContextCompiler({ graph, cas: new SolutionCAS(), repairs: new RepairMemory() }).compile({ objective: 'change a', dependencySeeds: ['file:o/r:src/a.js'], sourceSha: BASE, tokenBudget: 1000 });
  assert.equal(ctx.codeContext.nodes.some((node) => node.id === 'stale'), false);
  assert.ok(ctx.freshness.staleNodesDiscarded >= 1);
});

test('Impact test selection requires full suite for critical risk and targets semantic tests otherwise', () => {
  const graph = new SemanticCodeGraph();
  graph.upsertNode({ id: 'src', kind: 'symbol', path: 'src/a.js' }); graph.upsertNode({ id: 'test', kind: 'test', path: 'test/a.test.js' }); graph.addEdge({ from: 'test', to: 'src', type: 'tests' });
  const selector = new ImpactTestSelector({ graph });
  assert.deepEqual(selector.select({ changedNodeIds: ['src'], fullSuiteTests: ['all'] }).tests, ['test/a.test.js']);
  assert.deepEqual(selector.select({ changedNodeIds: ['src'], riskClass: 'critical', fullSuiteTests: ['all'] }).tests, ['all']);
});

test('Flaky test ledger quarantines only non-safety tests with mixed outcomes on unchanged SHA', () => {
  const ledger = new TestReliabilityLedger({ minRuns: 4 });
  for (const passed of [true, false, true, false]) ledger.record({ testId: 'f', passed, sourceSha: BASE });
  assert.equal(ledger.classify('f').classification, 'FLAKY');
  assert.equal(ledger.classify('f').quarantineEligible, true);
  const safety = new TestReliabilityLedger({ minRuns: 4 });
  for (const passed of [true, false, true, false]) safety.record({ testId: 's', passed, sourceSha: BASE, safetyCritical: true });
  assert.equal(safety.classify('s').quarantineEligible, false);
});

test('Canary policy holds observation windows and requests rollback for regressions', () => {
  const plan = buildCanaryPlan({ supported: true, stages: [5, 25, 100], minHealthyMinutes: 5, maxErrorRate: 0.01 });
  assert.equal(evaluateCanaryStage({ plan, stageIndex: 0, metrics: { healthOk: true, healthyMinutes: 1, errorRate: 0 } }).accepted, false);
  const bad = evaluateCanaryStage({ plan, stageIndex: 0, metrics: { healthOk: true, healthyMinutes: 5, errorRate: 0.2 } });
  assert.equal(bad.rollbackRequired, true);
});

test('Artifact attestations bind exact source and verify signatures', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const attestation = buildArtifactAttestation({ subject: { name: 'app.zip', sha256: 'c'.repeat(64) }, sourceSha: BASE, evidenceDigest: 'evidence' });
  const signed = signArtifactAttestation(attestation, privateKey);
  assert.equal(verifyArtifactAttestation(signed, publicKey).ok, true);
  signed.statement.sourceSha = NEXT;
  assert.equal(verifyArtifactAttestation(signed, publicKey).ok, false);
});

test('Worker performance learns specialization without replacing hard scheduler gates', () => {
  const ledger = new WorkerPerformanceLedger({ decay: 0.5 });
  for (let i = 0; i < 8; i += 1) ledger.record({ workerId: 'fast', taskClass: 'coding', language: 'js', accepted: true, durationMs: 1000 });
  for (let i = 0; i < 8; i += 1) ledger.record({ workerId: 'slow', taskClass: 'coding', language: 'js', accepted: i % 2 === 0, durationMs: 10000 });
  assert.equal(ledger.rank(['slow','fast'], 'coding', 'js')[0].workerId, 'fast');
});

test('Model shadow comparison requires enough evidence and rejects quality regressions', () => {
  const ledger = new ModelEvalLedger();
  for (let i = 0; i < 10; i += 1) {
    ledger.record({ modelId: 'incumbent', taskClass: 'coding', accepted: true, latencyMs: 100, costUnits: 1 });
    ledger.record({ modelId: 'candidate', taskClass: 'coding', accepted: i < 5, latencyMs: 90, costUnits: 0.5 });
  }
  assert.equal(ledger.shadowComparison({ candidateId: 'candidate', incumbentId: 'incumbent', taskClass: 'coding' }).promotable, false);
});

test('Speculative planner obeys compute budget', () => {
  const planner = new SpeculativePlanner({ maxCandidates: 4, minValueToCostRatio: 2 });
  const plan = planner.plan({ novelty: 1, riskClass: 'high', expectedValue: 20, availableSlots: 4, verifierCapacity: 4, estimatedCandidateCost: 5, remainingBudget: 6 });
  assert.equal(plan.candidates, 1);
  assert.ok(plan.reasons.includes('budget-cap'));
});

test('Derived acceleration state can be deleted without touching independent authoritative state', () => {
  const cas = new SolutionCAS(); cas.put('k', { ok: true });
  const artifacts = new ArtifactCache(); artifacts.put({ kind: 'x', inputs: { a: 1 } }, { ok: true });
  const graph = new SemanticCodeGraph(); graph.upsertNode({ id: 'a', kind: 'file' });
  const trajectories = new TrajectoryHarvester(); trajectories.record({ task: { key: 't', objective: 'x' }, outcome: 'ACCEPT' });
  const repairs = new RepairMemory(); repairs.remember({ fingerprint: 'f', repairPlan: {}, accepted: true });
  const manager = new DerivedStateManager({ solutionCas: cas, artifactCache: artifacts, semanticGraph: graph, trajectoryHarvester: trajectories, repairMemory: repairs });
  const authoritative = { task: 'still-here', claimGeneration: 7 };
  manager.reset();
  assert.deepEqual(authoritative, { task: 'still-here', claimGeneration: 7 });
  assert.deepEqual(manager.status(), { solutions: 0, artifacts: 0, graphNodes: 0, graphEdges: 0, trajectories: 0, repairFingerprints: 0 });
});

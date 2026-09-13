import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatchBundle, contentHash } from '../src/patch/patch-bundle.js';
import { PatchFabric, PatchSessionState } from '../src/patch/patch-fabric.js';
import { PatchComposer } from '../src/patch/patch-composer.js';
import { TransformRegistry, replaceTextTransform } from '../src/leverage/transform-registry.js';
import { TrajectoryHarvester } from '../src/leverage/trajectory-harvester.js';

const BASE = '1'.repeat(40);
const ACCEPTED = '2'.repeat(40);
function oneBundle() {
  return createPatchBundle({ taskKey: 's1', parentTaskKey: 'p', shardKey: 's1', baseSha: BASE, workerId: 'w1', generation: 1, scope: { files: ['a.js'] }, writes: [{ path: 'a.js', beforeHash: contentHash('old'), content: 'new' }] });
}

test('patch session survives controller restart while collecting shards', () => {
  const first = new PatchFabric(); const session = first.start({ parentTaskKey: 'p', baseSha: BASE, shardKeys: ['s1','s2'] }); first.submit(session.sessionId, oneBundle());
  const restored = new PatchFabric(); restored.restore(first.snapshot());
  assert.equal(restored.get(session.sessionId).state, PatchSessionState.COLLECTING);
  assert.equal(Object.keys(restored.get(session.sessionId).bundleDigests).length, 1);
});

test('composed patch result is deterministic and restart does not auto-accept it', () => {
  const bundle = oneBundle(); const composer = new PatchComposer();
  const a = composer.compose({ baseSha: BASE, baseFiles: { 'a.js': 'old' }, bundles: [bundle], parentTaskKey: 'p', now: 100 });
  const b = composer.compose({ baseSha: BASE, baseFiles: { 'a.js': 'old' }, bundles: [bundle], parentTaskKey: 'p', now: 100 });
  assert.equal(a.compositionDigest, b.compositionDigest);
  const fabric = new PatchFabric(); const session = fabric.start({ parentTaskKey: 'p', baseSha: BASE, shardKeys: ['s1'], now: 100 }); fabric.submit(session.sessionId, bundle, { now: 101 }); fabric.compose(session.sessionId, { baseFiles: { 'a.js': 'old' }, now: 102 });
  const restored = new PatchFabric(); restored.restore(fabric.snapshot());
  assert.equal(restored.get(session.sessionId).state, PatchSessionState.COMPOSED);
  assert.equal(restored.get(session.sessionId).acceptance, null);
  restored.recordParentVerification(session.sessionId, { accepted: true, acceptedSha: ACCEPTED, evidence: { suite: 'full' }, now: 103 });
  assert.equal(restored.get(session.sessionId).state, PatchSessionState.ACCEPTED);
});

test('stale generation and conflicting duplicate results fail closed', () => {
  const fabric = new PatchFabric(); const session = fabric.start({ parentTaskKey: 'p', baseSha: BASE, shardKeys: ['s1'] });
  const bundle = oneBundle();
  assert.throws(() => fabric.submit(session.sessionId, bundle, { expectedGeneration: 2 }), /stale shard generation/);
  fabric.submit(session.sessionId, bundle, { expectedGeneration: 1 });
  const conflict = createPatchBundle({ ...bundle, bundleDigest: undefined, writes: [{ path: 'a.js', beforeHash: contentHash('old'), content: 'different' }] });
  assert.throws(() => fabric.submit(session.sessionId, conflict), /conflicting duplicate shard result/);
});

test('declarative transforms restore without executable function serialization', async () => {
  const first = new TransformRegistry(); first.register(replaceTextTransform({ id: 'r', from: 'old', to: 'new', language: 'javascript' }));
  const restored = new TransformRegistry(); restored.restore(first.snapshot());
  const result = await restored.execute('r', { language: 'javascript', files: [{ path: 'a.js', content: 'old' }] });
  assert.equal(result.result.files[0].content, 'new');
});

test('legacy trajectory snapshots normalize into current semantic provenance', () => {
  const h = new TrajectoryHarvester(); h.restore({ version: 1, maxRecords: 10, records: [{ id: 'old', taskKey: 't', repository: 'r', taskClass: 'coding', objective: 'Fix API', outcome: 'ACCEPT', acceptance: {}, evidence: {}, repairHistory: [], source: 'legacy' }] });
  assert.equal(h.records[0].schemaVersion, 2);
  assert.match(h.records[0].semanticSignature, /^[0-9a-f]{64}$/);
  assert.equal(h.heldOutEvalRows().length, 1);
});

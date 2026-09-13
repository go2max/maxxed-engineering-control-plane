import test from 'node:test';
import assert from 'node:assert/strict';
import { DerivedStateManager, authoritativeRuntimeFingerprint } from '../src/leverage/derived-state.js';
import { SolutionCAS } from '../src/leverage/solution-cas.js';
import { ArtifactCache } from '../src/leverage/artifact-cache.js';
import { SemanticCodeGraph } from '../src/leverage/semantic-code-graph.js';
import { TrajectoryHarvester } from '../src/leverage/trajectory-harvester.js';
import { RepairMemory } from '../src/leverage/repair-memory.js';

function acceptedTask({ key = 'task-1', repair = false } = {}) {
  return {
    key,
    repository: 'org/repo',
    taskClass: repair ? 'repair' : 'coding',
    objective: repair ? 'repair validation failure' : 'implement feature',
    state: 'ACCEPTED',
    metadata: {
      acceptance: { requiredChecks: ['unit'] },
      leverage: { solutionKey: `solution-${key}` },
      ...(repair ? { repairOf: 'parent-1', failureFingerprint: 'fp-1', repairPlan: { action: 'fix-test' } } : {})
    },
    lineage: [{
      state: 'ACCEPTED',
      evidence: {
        evidenceBundle: {
          digest: `digest-${key}`,
          payload: { evidence: { artifacts: { commitSha: `sha-${key}`, summary: `summary-${key}` } } }
        }
      }
    }]
  };
}

function runtime(tasks = [acceptedTask(), acceptedTask({ key: 'repair-1', repair: true })]) {
  const snapshot = {
    version: 6,
    core: { version: 1, capturedAt: 123, graph: { version: 1, tasks: [] }, claims: { version: 1, claims: [] }, repairs: { version: 1, rows: [] } },
    policy: { version: 1, paused: false },
    journal: { version: 1, sequence: 2, events: [{ sequence: 1, type: 'task.accepted' }] },
    verification: { version: 1, sequence: 1, entries: [] },
    models: { governor: { version: 1, rows: [] }, evals: { version: 1, rows: [] }, lastDiscovery: null },
    paused: false,
    repositoryLaneLimits: { 'org/repo': 2 }
  };
  return {
    graph: { list: () => structuredClone(tasks) },
    snapshot: () => structuredClone(snapshot),
    mutateAuthority() { snapshot.repositoryLaneLimits['org/repo'] = 99; }
  };
}

function manager() {
  const solutionCas = new SolutionCAS();
  const artifactCache = new ArtifactCache();
  const semanticGraph = new SemanticCodeGraph();
  const trajectoryHarvester = new TrajectoryHarvester();
  const repairMemory = new RepairMemory();
  const derived = new DerivedStateManager({ solutionCas, artifactCache, semanticGraph, trajectoryHarvester, repairMemory });
  return { derived, solutionCas, artifactCache, semanticGraph, trajectoryHarvester, repairMemory };
}

test('authority fingerprint ignores runtime capture timestamp but not authority changes', () => {
  const subject = runtime();
  const a = authoritativeRuntimeFingerprint(subject);
  const original = subject.snapshot;
  subject.snapshot = () => { const value = original(); value.core.capturedAt = 999999; return value; };
  assert.equal(authoritativeRuntimeFingerprint(subject), a);
  subject.mutateAuthority();
  assert.notEqual(authoritativeRuntimeFingerprint(subject), a);
});

test('disposability drill wipes rebuilds and restores derived state without changing authority', async () => {
  const { derived, solutionCas, artifactCache, semanticGraph, trajectoryHarvester, repairMemory } = manager();
  solutionCas.put('existing-solution', { ok: true });
  artifactCache.put('existing-artifact', { bytes: 10 });
  semanticGraph.upsertNode({ id: 'file:a', kind: 'file', path: 'a.js' });
  trajectoryHarvester.record({ task: acceptedTask({ key: 'seed' }), outcome: 'ACCEPT', evidence: { digest: 'seed' } });
  repairMemory.remember({ fingerprint: 'seed-fp', repairPlan: { action: 'seed' } });
  const subject = runtime();
  const before = derived.status();
  const fingerprint = authoritativeRuntimeFingerprint(subject);

  const result = await derived.disposabilityDrill({ runtime: subject, now: 1000 });

  assert.equal(result.passed, true);
  assert.equal(result.authorityFingerprint, fingerprint);
  assert.deepEqual(result.statusBefore, before);
  assert.deepEqual(result.resetStatus, { solutions: 0, artifacts: 0, graphNodes: 0, graphEdges: 0, trajectories: 0, repairFingerprints: 0 });
  assert.equal(result.rebuildResult.rebuilt.solutions, 2);
  assert.equal(result.rebuildResult.rebuilt.trajectories, 2);
  assert.equal(result.rebuildResult.rebuilt.repairs, 1);
  assert.equal(result.rebuildResult.requiresSourceReindex, true);
  assert.equal(result.rebuildResult.requiresArtifactRegeneration, true);
  assert.deepEqual(derived.status(), before);
  assert.equal(authoritativeRuntimeFingerprint(subject), fingerprint);
});

test('disposability drill fails if a rebuild callback mutates authority and still restores derived state', async () => {
  const { derived, solutionCas } = manager();
  solutionCas.put('keep-me', { ok: true });
  const subject = runtime();
  const before = derived.status();
  await assert.rejects(() => derived.disposabilityDrill({
    runtime: subject,
    rebuild: async ({ runtime: active }) => { active.mutateAuthority(); return { bad: true }; }
  }), /rebuild mutated authoritative runtime state/);
  assert.deepEqual(derived.status(), before);
});

test('drill can intentionally leave rebuilt acceleration state in place', async () => {
  const { derived } = manager();
  const subject = runtime([acceptedTask()]);
  const result = await derived.disposabilityDrill({ runtime: subject, restoreAfter: false, now: 2000 });
  assert.equal(result.restored, false);
  assert.equal(result.statusAfterRestore, null);
  assert.equal(result.statusAfterRebuild.solutions, 1);
  assert.equal(result.statusAfterRebuild.trajectories, 1);
  assert.equal(derived.status().solutions, 1);
});

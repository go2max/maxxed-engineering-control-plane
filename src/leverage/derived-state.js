import { digest } from './solution-cas.js';

function stableAuthoritySnapshot(runtime) {
  if (!runtime?.snapshot) throw new Error('runtime with snapshot() is required');
  const snapshot = structuredClone(runtime.snapshot());
  if (snapshot?.core && Object.prototype.hasOwnProperty.call(snapshot.core, 'capturedAt')) snapshot.core.capturedAt = 0;
  return snapshot;
}

export function authoritativeRuntimeFingerprint(runtime) {
  return digest(stableAuthoritySnapshot(runtime));
}

function acceptedBundle(task) {
  return [...(task?.lineage ?? [])].reverse().find((entry) => entry.state === 'ACCEPTED' && entry.evidence?.evidenceBundle)?.evidence?.evidenceBundle ?? null;
}

export class DerivedStateManager {
  constructor({ solutionCas, artifactCache, semanticGraph, trajectoryHarvester, repairMemory } = {}) {
    this.solutionCas = solutionCas; this.artifactCache = artifactCache; this.semanticGraph = semanticGraph; this.trajectoryHarvester = trajectoryHarvester; this.repairMemory = repairMemory;
  }

  status() {
    return {
      solutions: this.solutionCas?.entries?.size ?? 0,
      artifacts: this.artifactCache?.entries?.size ?? 0,
      graphNodes: this.semanticGraph?.nodes?.size ?? 0,
      graphEdges: this.semanticGraph?.edges?.size ?? 0,
      trajectories: this.trajectoryHarvester?.records?.length ?? 0,
      repairFingerprints: this.repairMemory?.byFingerprint?.size ?? 0
    };
  }

  reset({ includeTraining = true } = {}) {
    this.solutionCas?.entries?.clear?.();
    this.artifactCache?.entries?.clear?.();
    this.semanticGraph?.restore?.({ version: 1, nodes: [], edges: [] });
    if (includeTraining && this.trajectoryHarvester) { this.trajectoryHarvester.records = []; this.trajectoryHarvester.revocations?.clear?.(); }
    this.repairMemory?.byFingerprint?.clear?.();
    return this.status();
  }

  snapshot() {
    return {
      version: 1,
      solutionCas: this.solutionCas?.snapshot?.() ?? null,
      artifactCache: this.artifactCache?.snapshot?.() ?? null,
      semanticGraph: this.semanticGraph?.snapshot?.() ?? null,
      trajectories: this.trajectoryHarvester?.snapshot?.() ?? null,
      repairMemory: this.repairMemory?.snapshot?.() ?? null
    };
  }

  restore(snapshot) {
    if (!snapshot) return this.status();
    if (snapshot.version !== 1) throw new Error('unsupported derived-state snapshot');
    if (snapshot.solutionCas) this.solutionCas?.restore?.(snapshot.solutionCas);
    if (snapshot.artifactCache) this.artifactCache?.restore?.(snapshot.artifactCache);
    if (snapshot.semanticGraph) this.semanticGraph?.restore?.(snapshot.semanticGraph);
    if (snapshot.trajectories) this.trajectoryHarvester?.restore?.(snapshot.trajectories);
    if (snapshot.repairMemory) this.repairMemory?.restore?.(snapshot.repairMemory);
    return this.status();
  }

  rebuildFromRuntime(runtime, { now = Date.now() } = {}) {
    if (!runtime?.graph?.list) throw new Error('runtime graph is required');
    let solutions = 0; let trajectories = 0; let repairs = 0;
    for (const task of runtime.graph.list()) {
      const bundle = acceptedBundle(task);
      if (task.state !== 'ACCEPTED' || !bundle) continue;
      const artifacts = bundle?.payload?.evidence?.artifacts ?? {};
      const solutionKey = task.metadata?.leverage?.solutionKey;
      if (solutionKey && this.solutionCas?.put) {
        this.solutionCas.put(solutionKey, { evidenceBundle: structuredClone(bundle), artifacts: structuredClone(artifacts), acceptedAt: now }, {
          confidence: 1,
          reusable: true,
          tags: [task.taskClass ?? 'coding', task.repository ?? 'unknown'],
          now
        });
        solutions += 1;
      }
      if (this.trajectoryHarvester?.record) {
        this.trajectoryHarvester.record({
          task,
          outcome: 'ACCEPT',
          evidence: { digest: bundle.digest ?? null, artifacts: structuredClone(artifacts) },
          source: 'authoritative-runtime-rebuild',
          sourceRefs: [artifacts.commitSha].filter(Boolean),
          timing: { rebuiltAt: now }
        });
        trajectories += 1;
      }
      if (task.metadata?.repairOf && task.metadata?.failureFingerprint && this.repairMemory?.remember) {
        this.repairMemory.remember({
          fingerprint: task.metadata.failureFingerprint,
          taskClass: task.taskClass ?? 'repair',
          repairPlan: task.metadata.repairPlan ?? null,
          patchSummary: artifacts.summary ?? task.objective ?? null,
          commitSha: artifacts.commitSha ?? null,
          accepted: true,
          metadata: { repairOf: task.metadata.repairOf, repository: task.repository },
          now
        });
        repairs += 1;
      }
    }
    return {
      rebuilt: { solutions, trajectories, repairs },
      requiresSourceReindex: true,
      requiresArtifactRegeneration: true,
      status: this.status()
    };
  }

  async disposabilityDrill({ runtime, rebuild = true, includeTraining = true, restoreAfter = true, now = Date.now() } = {}) {
    if (!runtime) throw new Error('runtime is required');
    const authorityBefore = authoritativeRuntimeFingerprint(runtime);
    const derivedBefore = this.snapshot();
    const statusBefore = this.status();
    let rebuildResult = null;
    try {
      const resetStatus = this.reset({ includeTraining });
      const authorityAfterReset = authoritativeRuntimeFingerprint(runtime);
      if (authorityAfterReset !== authorityBefore) throw new Error('derived-state reset mutated authoritative runtime state');
      if (rebuild) rebuildResult = typeof rebuild === 'function'
        ? await rebuild({ runtime, derivedState: this, now })
        : this.rebuildFromRuntime(runtime, { now });
      const authorityAfterRebuild = authoritativeRuntimeFingerprint(runtime);
      if (authorityAfterRebuild !== authorityBefore) throw new Error('derived-state rebuild mutated authoritative runtime state');
      const statusAfterRebuild = this.status();
      if (restoreAfter) this.restore(derivedBefore);
      const authorityAfterRestore = authoritativeRuntimeFingerprint(runtime);
      if (authorityAfterRestore !== authorityBefore) throw new Error('derived-state restore mutated authoritative runtime state');
      return {
        passed: true,
        authorityFingerprint: authorityBefore,
        statusBefore,
        resetStatus,
        rebuildResult,
        statusAfterRebuild,
        statusAfterRestore: restoreAfter ? this.status() : null,
        restored: Boolean(restoreAfter),
        at: Number(now)
      };
    } catch (error) {
      if (restoreAfter) this.restore(derivedBefore);
      throw error;
    }
  }
}

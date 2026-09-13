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
}

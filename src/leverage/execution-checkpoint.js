// Resumable agent execution checkpoints (issue #65, section 8) with stale-lease fencing
// (issue #65, section 9/8 safety boundary): a checkpoint written under an older generation
// than the one already on record is rejected rather than silently clobbering newer progress,
// and resume() enforces the same floor so a stale worker cannot resume/mutate past a
// reassignment.
export class ExecutionCheckpointStore {
  constructor({ maxEntries = 5_000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries));
    this.checkpoints = new Map();
  }

  save(taskKey, checkpoint = {}, { generation = 1, now = Date.now() } = {}) {
    if (!taskKey) throw new Error('taskKey is required');
    const existing = this.checkpoints.get(taskKey);
    if (existing && Number(generation) < Number(existing.generation)) {
      const error = new Error('stale checkpoint generation rejected by lease fencing');
      error.code = 'STALE_GENERATION';
      error.currentGeneration = existing.generation;
      throw error;
    }
    const row = {
      taskKey,
      generation: Number(generation),
      sourceSha: checkpoint.sourceSha ?? null,
      fingerprint: checkpoint.fingerprint ?? null,
      completedSteps: checkpoint.completedSteps ?? [],
      filesInspected: checkpoint.filesInspected ?? [],
      edits: checkpoint.edits ?? [],
      branchRef: checkpoint.branchRef ?? null,
      validations: checkpoint.validations ?? [],
      blockerFingerprint: checkpoint.blockerFingerprint ?? null,
      nextActions: checkpoint.nextActions ?? [],
      pendingGate: checkpoint.pendingGate ?? null,
      workerId: checkpoint.workerId ?? null,
      updatedAt: now
    };
    this.checkpoints.set(taskKey, row);
    while (this.checkpoints.size > this.maxEntries) this.checkpoints.delete(this.checkpoints.keys().next().value);
    return structuredClone(row);
  }

  // resume returns the persisted checkpoint so a compatible worker can continue instead of
  // restarting repository/task discovery from zero. When minGeneration is supplied (the
  // resuming worker's own lease generation), a checkpoint recorded under an older generation
  // than what fencing has already advanced past is rejected.
  resume(taskKey, { minGeneration = 0 } = {}) {
    const row = this.checkpoints.get(taskKey);
    if (!row) return null;
    if (Number(row.generation) < Number(minGeneration)) {
      const error = new Error('checkpoint generation predates required lease fencing');
      error.code = 'STALE_GENERATION';
      error.currentGeneration = row.generation;
      throw error;
    }
    return structuredClone(row);
  }

  peek(taskKey) {
    const row = this.checkpoints.get(taskKey);
    return row ? structuredClone(row) : null;
  }

  clear(taskKey) { return this.checkpoints.delete(taskKey); }

  snapshot() {
    return { version: 1, maxEntries: this.maxEntries, checkpoints: [...this.checkpoints.values()].map((row) => structuredClone(row)) };
  }

  restore(snapshot) {
    this.maxEntries = Math.max(1, Number(snapshot?.maxEntries ?? this.maxEntries));
    this.checkpoints = new Map((snapshot?.checkpoints ?? []).map((row) => [row.taskKey, structuredClone(row)]));
  }
}

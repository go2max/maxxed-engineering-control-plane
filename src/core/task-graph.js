export const TaskState = Object.freeze({
  PLANNED: 'PLANNED',
  READY: 'READY',
  CLAIMED: 'CLAIMED',
  ACCEPTED: 'ACCEPTED',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

const terminalAccepted = new Set([TaskState.ACCEPTED]);

function normalizeTask(input) {
  if (!input?.key) throw new Error('task key is required');
  return {
    key: input.key,
    repository: input.repository ?? null,
    product: input.product ?? null,
    objective: input.objective ?? '',
    dependencies: [...new Set(input.dependencies ?? [])],
    blockers: [...new Set(input.blockers ?? [])],
    humanGates: [...new Set(input.humanGates ?? [])],
    riskClass: input.riskClass ?? 'normal',
    taskClass: input.taskClass ?? 'standard',
    requirements: input.requirements ?? {},
    dedupeKey: input.dedupeKey ?? input.key,
    state: input.state ?? TaskState.PLANNED,
    lineage: [...(input.lineage ?? [])],
    metadata: input.metadata ?? {}
  };
}

export class TaskGraph {
  #tasks = new Map();

  add(input) {
    const task = normalizeTask(input);
    if (this.#tasks.has(task.key)) throw new Error(`duplicate task key: ${task.key}`);
    const duplicate = [...this.#tasks.values()].find((candidate) => candidate.dedupeKey === task.dedupeKey);
    if (duplicate) throw new Error(`duplicate dedupe key: ${task.dedupeKey}`);
    this.#tasks.set(task.key, task);
    this.#assertAcyclic();
    return this.get(task.key);
  }

  upsert(input) {
    if (!this.#tasks.has(input.key)) return this.add(input);
    const previous = this.#tasks.get(input.key);
    const next = normalizeTask({ ...previous, ...input, lineage: input.lineage ?? previous.lineage });
    this.#tasks.set(next.key, next);
    try { this.#assertAcyclic(); }
    catch (error) { this.#tasks.set(previous.key, previous); throw error; }
    return this.get(next.key);
  }

  get(key) { const task = this.#tasks.get(key); return task ? structuredClone(task) : null; }
  list() { return [...this.#tasks.values()].map((task) => structuredClone(task)); }

  snapshot() { return { version: 1, tasks: this.list() }; }

  restore(snapshot, now = Date.now(), { activeClaimTaskKeys = new Set(), expiredClaimTaskKeys = new Set() } = {}) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported task graph snapshot');
    this.#tasks.clear();
    for (const input of snapshot.tasks ?? []) {
      const task = normalizeTask(input);
      if (task.state === TaskState.CLAIMED && !activeClaimTaskKeys.has(task.key)) {
        task.state = task.metadata?.restartable === false ? TaskState.BLOCKED : TaskState.READY;
        const reason = expiredClaimTaskKeys.has(task.key)
          ? (task.metadata?.restartable === false ? 'restored claim expired during non-restartable work' : 'restored claim expired; task returned to frontier')
          : 'control-plane restart found no active claim';
        task.lineage.push({ at: now, state: task.state, evidence: { reason } });
      }
      this.#tasks.set(task.key, task);
    }
    this.#assertAcyclic();
    return this.list();
  }

  setState(key, state, evidence = null) {
    const task = this.#require(key);
    task.state = state;
    if (evidence) task.lineage.push({ at: Date.now(), state, evidence });
    return this.get(key);
  }

  blockerReasons(key) {
    const task = this.#require(key);
    const reasons = [];
    for (const dep of task.dependencies) {
      const dependency = this.#tasks.get(dep);
      if (!dependency) reasons.push(`missing dependency:${dep}`);
      else if (!terminalAccepted.has(dependency.state)) reasons.push(`dependency not accepted:${dep}`);
    }
    for (const blocker of task.blockers) reasons.push(`blocker:${blocker}`);
    for (const gate of task.humanGates) reasons.push(`human gate:${gate}`);
    if ([TaskState.ACCEPTED, TaskState.CANCELLED].includes(task.state)) reasons.push(`terminal state:${task.state}`);
    if ([TaskState.BLOCKED, TaskState.FAILED].includes(task.state)) reasons.push(`non-executable state:${task.state}`);
    if (task.state === TaskState.CLAIMED) reasons.push('already claimed');
    return reasons;
  }

  isExecutable(key) { return this.blockerReasons(key).length === 0; }
  frontier(predicate = () => true) { return this.list().filter((task) => predicate(task) && this.isExecutable(task.key)).sort((a, b) => a.key.localeCompare(b.key)); }
  dependentsOf(key) { return this.list().filter((task) => task.dependencies.includes(key)); }
  unlockCount(key) {
    return this.dependentsOf(key).filter((task) => {
      const remaining = task.dependencies.filter((dep) => dep !== key);
      return remaining.every((dep) => terminalAccepted.has(this.#tasks.get(dep)?.state));
    }).length;
  }

  #require(key) { const task = this.#tasks.get(key); if (!task) throw new Error(`unknown task: ${key}`); return task; }
  #assertAcyclic() {
    const visiting = new Set(); const visited = new Set();
    const visit = (key) => {
      if (visited.has(key)) return;
      if (visiting.has(key)) throw new Error(`dependency cycle detected at ${key}`);
      visiting.add(key);
      const task = this.#tasks.get(key);
      for (const dep of task?.dependencies ?? []) if (this.#tasks.has(dep)) visit(dep);
      visiting.delete(key); visited.add(key);
    };
    for (const key of this.#tasks.keys()) visit(key);
  }
}

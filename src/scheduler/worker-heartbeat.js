// Worker heartbeat/liveness tracking, separated from lease ownership (issue #47).
//
// Per the researched patterns (Temporal separates heartbeat/liveness from attempt timeout;
// Argo does not revoke held ownership merely because a controller heartbeat is stale;
// Kubernetes controller-runtime treats a missed heartbeat as "suspect" and stops new work
// before anything is reassigned): a missed heartbeat makes a worker *suspect* and stops new
// task assignment to it, but it never itself revokes a lease the worker already holds. Lease
// revocation stays the sole responsibility of ClaimAuthority (TTL expiry + fencing), so there
// is exactly one authority for "who owns this task" and heartbeat tracking never competes
// with it.
export class WorkerHeartbeatMonitor {
  #lastSeen = new Map();

  constructor({ suspectAfterMs = 15_000 } = {}) {
    if (!Number.isFinite(suspectAfterMs) || suspectAfterMs <= 0) throw new Error('suspectAfterMs must be a positive number');
    this.suspectAfterMs = suspectAfterMs;
  }

  // Record a heartbeat from a worker. Call this on any liveness signal (poll, progress
  // update, claim renewal) - it never touches lease state.
  heartbeat(workerId, now = Date.now()) {
    if (!workerId) throw new Error('workerId is required');
    this.#lastSeen.set(workerId, now);
  }

  // A worker with no recorded heartbeat is treated as unknown, not suspect: this monitor is
  // additive safety, not a source of truth for "worker exists".
  isSuspect(workerId, now = Date.now()) {
    const lastSeen = this.#lastSeen.get(workerId);
    if (lastSeen == null) return false;
    return now - lastSeen > this.suspectAfterMs;
  }

  lastSeen(workerId) {
    return this.#lastSeen.get(workerId) ?? null;
  }

  forget(workerId) {
    return this.#lastSeen.delete(workerId);
  }

  // Filters a worker list down to those eligible for *new* assignment. Workers already
  // holding an active claim keep it regardless of suspicion - only new dispatch is withheld.
  eligibleForNewWork(workers, now = Date.now()) {
    return workers.filter((worker) => !this.isSuspect(worker.workerId, now));
  }

  snapshot() {
    return { version: 1, suspectAfterMs: this.suspectAfterMs, lastSeen: [...this.#lastSeen.entries()] };
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported worker heartbeat snapshot');
    this.suspectAfterMs = Number(snapshot.suspectAfterMs ?? this.suspectAfterMs);
    this.#lastSeen = new Map(snapshot.lastSeen ?? []);
  }
}

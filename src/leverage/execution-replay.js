export class ExecutionReplayProjector {
  constructor() { this.handlers = new Map(); }
  on(type, handler) { if (!type || typeof handler !== 'function') throw new Error('type and handler are required'); this.handlers.set(type, handler); return this; }
  replay(events = [], seed = {}) {
    let state = structuredClone(seed);
    for (const event of [...events].sort((a,b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))) {
      const handler = this.handlers.get(event.type);
      if (handler) state = handler(structuredClone(state), structuredClone(event)) ?? state;
    }
    return state;
  }
}

export function defaultControlPlaneReplayProjector() {
  return new ExecutionReplayProjector()
    .on('task.ingested', (state, event) => ({ ...state, tasks: { ...(state.tasks ?? {}), [event.payload?.taskKey]: { state: 'INGESTED', lastSequence: event.sequence } } }))
    .on('dispatch.issued', (state, event) => {
      const tasks = { ...(state.tasks ?? {}) };
      for (const key of event.payload?.tasks ?? []) tasks[key] = { ...(tasks[key] ?? {}), state: 'DISPATCHED', lastSequence: event.sequence };
      return { ...state, tasks };
    })
    .on('task.completed', (state, event) => ({ ...state, tasks: { ...(state.tasks ?? {}), [event.payload?.taskKey]: { ...(state.tasks?.[event.payload?.taskKey] ?? {}), state: event.payload?.action ?? 'COMPLETED', verdict: event.payload?.verdict ?? null, lastSequence: event.sequence } } }))
    .on('coding.pr.promoted', (state, event) => ({ ...state, pullRequests: [...(state.pullRequests ?? []), structuredClone(event.payload)] }));
}

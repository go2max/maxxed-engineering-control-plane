import { digest } from './solution-cas.js';

export class TransformRegistry {
  constructor() { this.transforms = new Map(); }

  register(transform) {
    if (!transform?.id || typeof transform.apply !== 'function') throw new Error('transform id and apply function are required');
    if (this.transforms.has(transform.id)) throw new Error(`duplicate transform: ${transform.id}`);
    const row = { id: transform.id, version: String(transform.version ?? '1'), taskClasses: [...new Set(transform.taskClasses ?? [])], match: transform.match ?? (() => true), apply: transform.apply, verify: transform.verify ?? null, metadata: structuredClone(transform.metadata ?? {}) };
    this.transforms.set(row.id, row); return row.id;
  }

  candidates(context = {}) {
    return [...this.transforms.values()].filter((t) => t.match(context)).sort((a,b) => Number(b.metadata?.priority ?? 0) - Number(a.metadata?.priority ?? 0) || a.id.localeCompare(b.id));
  }

  async execute(id, context = {}) {
    const t = this.transforms.get(id); if (!t) throw new Error(`unknown transform: ${id}`);
    const inputDigest = digest(context);
    const result = await t.apply(structuredClone(context));
    if (t.verify) { const verdict = await t.verify(structuredClone(result), structuredClone(context)); if (verdict !== true) throw new Error(`transform verification failed: ${id}`); }
    return { transformId: t.id, transformVersion: t.version, inputDigest, outputDigest: digest(result), deterministicKey: digest({ id: t.id, version: t.version, inputDigest }), result };
  }

  manifest() { return [...this.transforms.values()].map((t) => ({ id: t.id, version: t.version, taskClasses: [...t.taskClasses], metadata: structuredClone(t.metadata) })); }
}

export function replaceTextTransform({ id, version = '1', from, to, taskClasses = ['migration'], fileFilter = () => true } = {}) {
  if (!id || typeof from !== 'string' || typeof to !== 'string') throw new Error('id/from/to are required');
  return {
    id, version, taskClasses,
    match: (context) => Array.isArray(context.files) && context.files.some((f) => fileFilter(f.path) && String(f.content).includes(from)),
    apply: (context) => ({ ...context, files: context.files.map((f) => fileFilter(f.path) ? { ...f, content: String(f.content).split(from).join(to) } : f) }),
    verify: (result) => result.files.every((f) => !fileFilter(f.path) || !String(f.content).includes(from)),
    metadata: { kind: 'deterministic-text-rewrite' }
  };
}

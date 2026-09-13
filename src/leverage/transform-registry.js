import { digest } from './solution-cas.js';

export class TransformRegistry {
  constructor() { this.transforms = new Map(); }

  register(transform) {
    if (!transform?.id || typeof transform.apply !== 'function') throw new Error('transform id and apply function are required');
    if (this.transforms.has(transform.id)) throw new Error(`duplicate transform: ${transform.id}`);
    const row = { id: transform.id, version: String(transform.version ?? '1'), taskClasses: [...new Set(transform.taskClasses ?? [])], match: transform.match ?? (() => true), apply: transform.apply, verify: transform.verify ?? null, metadata: structuredClone(transform.metadata ?? {}), definition: transform.definition ? structuredClone(transform.definition) : null };
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

  manifest() { return [...this.transforms.values()].map((t) => ({ id: t.id, version: t.version, taskClasses: [...t.taskClasses], metadata: structuredClone(t.metadata), persistent: Boolean(t.definition) })); }
  snapshot() { return { version: 1, definitions: [...this.transforms.values()].filter((t) => t.definition).map((t) => structuredClone(t.definition)) }; }
  restore(snapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new Error('unsupported transform registry snapshot');
    for (const definition of snapshot.definitions ?? []) {
      if (definition.kind === 'replace-text' && !this.transforms.has(definition.id)) this.register(replaceTextTransform(definition));
    }
  }
}

export function replaceTextTransform({ id, version = '1', from, to, taskClasses = ['migration'], pathIncludes = null, fileFilter = null } = {}) {
  if (!id || typeof from !== 'string' || typeof to !== 'string') throw new Error('id/from/to are required');
  const filter = typeof fileFilter === 'function' ? fileFilter : (filePath) => pathIncludes ? String(filePath).includes(String(pathIncludes)) : true;
  const definition = typeof fileFilter === 'function' ? null : { kind: 'replace-text', id, version: String(version), from, to, taskClasses: [...taskClasses], pathIncludes };
  return {
    id, version, taskClasses,
    match: (context) => Array.isArray(context.files) && context.files.some((f) => filter(f.path) && String(f.content).includes(from)),
    apply: (context) => ({ ...context, files: context.files.map((f) => filter(f.path) ? { ...f, content: String(f.content).split(from).join(to) } : f) }),
    verify: (result) => result.files.every((f) => !filter(f.path) || !String(f.content).includes(from)),
    metadata: { kind: 'deterministic-text-rewrite' },
    definition
  };
}

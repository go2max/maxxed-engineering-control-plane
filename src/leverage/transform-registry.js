import { digest } from './solution-cas.js';

function normalizeVersion(value) { return String(value ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0); }
function compareVersion(a, b) { const left = normalizeVersion(a); const right = normalizeVersion(b); const length = Math.max(left.length, right.length); for (let i = 0; i < length; i += 1) { const diff = (left[i] ?? 0) - (right[i] ?? 0); if (diff) return diff; } return 0; }

function guardsAllow(guards = {}, context = {}) {
  if (guards.languages?.length && !guards.languages.includes(context.language)) return false;
  if (guards.minToolchainVersion && compareVersion(context.toolchainVersion, guards.minToolchainVersion) < 0) return false;
  if (guards.maxToolchainVersion && compareVersion(context.toolchainVersion, guards.maxToolchainVersion) > 0) return false;
  if (guards.requiredFiles?.length) {
    const paths = new Set((context.files ?? []).map((file) => file.path));
    if (!guards.requiredFiles.every((file) => paths.has(file))) return false;
  }
  return true;
}

function rollbackManifest(before = {}, after = {}, transform) {
  const beforeFiles = new Map((before.files ?? []).map((file) => [file.path, file.content]));
  const afterFiles = new Map((after.files ?? []).map((file) => [file.path, file.content]));
  const paths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort();
  const reverseWrites = paths.filter((file) => beforeFiles.get(file) !== afterFiles.get(file)).map((file) => ({ path: file, delete: !beforeFiles.has(file), content: beforeFiles.has(file) ? beforeFiles.get(file) : null }));
  return { version: 1, transformId: transform.id, transformVersion: transform.version, reverseWrites, beforeDigest: digest(before), afterDigest: digest(after) };
}

export class TransformRegistry {
  constructor() { this.transforms = new Map(); }

  register(transform) {
    if (!transform?.id || typeof transform.apply !== 'function') throw new Error('transform id and apply function are required');
    if (this.transforms.has(transform.id)) throw new Error(`duplicate transform: ${transform.id}`);
    const row = {
      id: transform.id,
      version: String(transform.version ?? '1'),
      taskClasses: [...new Set(transform.taskClasses ?? [])],
      match: transform.match ?? (() => true),
      apply: transform.apply,
      verify: transform.verify ?? null,
      preconditions: [...(transform.preconditions ?? [])],
      postconditions: [...(transform.postconditions ?? [])],
      guards: structuredClone(transform.guards ?? {}),
      metadata: structuredClone(transform.metadata ?? {}),
      definition: transform.definition ? structuredClone(transform.definition) : null
    };
    this.transforms.set(row.id, row); return row.id;
  }

  candidates(context = {}) {
    return [...this.transforms.values()]
      .filter((transform) => guardsAllow(transform.guards, context) && transform.match(context))
      .sort((a,b) => Number(b.metadata?.priority ?? 0) - Number(a.metadata?.priority ?? 0) || a.id.localeCompare(b.id));
  }

  async execute(id, context = {}) {
    const transform = this.transforms.get(id); if (!transform) throw new Error(`unknown transform: ${id}`);
    if (!guardsAllow(transform.guards, context)) throw new Error(`transform guards rejected context: ${id}`);
    for (const [index, precondition] of transform.preconditions.entries()) if (await precondition(structuredClone(context)) !== true) throw new Error(`transform precondition ${index + 1} failed: ${id}`);
    const input = structuredClone(context); const inputDigest = digest(input);
    const result = await transform.apply(structuredClone(input));
    if (transform.verify) { const verdict = await transform.verify(structuredClone(result), structuredClone(input)); if (verdict !== true) throw new Error(`transform verification failed: ${id}`); }
    for (const [index, postcondition] of transform.postconditions.entries()) if (await postcondition(structuredClone(result), structuredClone(input)) !== true) throw new Error(`transform postcondition ${index + 1} failed: ${id}`);
    const outputDigest = digest(result);
    return {
      transformId: transform.id,
      transformVersion: transform.version,
      inputDigest,
      outputDigest,
      deterministicKey: digest({ id: transform.id, version: transform.version, inputDigest }),
      rollback: rollbackManifest(input, result, transform),
      result
    };
  }

  manifest() { return [...this.transforms.values()].map((transform) => ({ id: transform.id, version: transform.version, taskClasses: [...transform.taskClasses], guards: structuredClone(transform.guards), metadata: structuredClone(transform.metadata), persistent: Boolean(transform.definition) })); }
  snapshot() { return { version: 2, definitions: [...this.transforms.values()].filter((transform) => transform.definition).map((transform) => structuredClone(transform.definition)) }; }
  restore(snapshot) {
    if (!snapshot) return;
    if (![1, 2].includes(snapshot.version)) throw new Error('unsupported transform registry snapshot');
    for (const definition of snapshot.definitions ?? []) if (definition.kind === 'replace-text' && !this.transforms.has(definition.id)) this.register(replaceTextTransform(definition));
  }
}

export function replaceTextTransform({ id, version = '1', from, to, taskClasses = ['migration'], pathIncludes = null, fileFilter = null, language = null, minMatches = 1, maxMatches = null, guards = {} } = {}) {
  if (!id || typeof from !== 'string' || typeof to !== 'string') throw new Error('id/from/to are required');
  const filter = typeof fileFilter === 'function' ? fileFilter : (filePath) => pathIncludes ? String(filePath).includes(String(pathIncludes)) : true;
  const transformGuards = { ...guards, ...(language ? { languages: [...new Set([...(guards.languages ?? []), language])] } : {}) };
  const countMatches = (context) => (context.files ?? []).reduce((sum, file) => filter(file.path) ? sum + String(file.content).split(from).length - 1 : sum, 0);
  const definition = typeof fileFilter === 'function' ? null : { kind: 'replace-text', id, version: String(version), from, to, taskClasses: [...taskClasses], pathIncludes, language, minMatches, maxMatches, guards: transformGuards };
  return {
    id, version, taskClasses, guards: transformGuards,
    match: (context) => countMatches(context) >= Number(minMatches),
    preconditions: [(context) => { const count = countMatches(context); return count >= Number(minMatches) && (maxMatches == null || count <= Number(maxMatches)); }],
    apply: (context) => ({ ...context, files: context.files.map((file) => filter(file.path) ? { ...file, content: String(file.content).split(from).join(to) } : file) }),
    verify: (result) => result.files.every((file) => !filter(file.path) || !String(file.content).includes(from)),
    postconditions: [(result) => countMatches(result) === 0],
    metadata: { kind: 'deterministic-text-rewrite', reversible: true },
    definition
  };
}

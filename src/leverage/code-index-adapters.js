function fileId(repository, path) { return `file:${repository}:${String(path).replaceAll('\\','/')}`; }
function symbolId(repository, symbol) { return `scip:${repository}:${symbol}`; }

export class CodeIndexAdapterRegistry {
  constructor() { this.adapters = new Map(); }
  register(name, adapter) { if (!name || !adapter?.index) throw new Error('adapter name and index() are required'); this.adapters.set(String(name), adapter); return String(name); }
  get(name) { return this.adapters.get(String(name)) ?? null; }
  async index(name, input) { const adapter = this.get(name); if (!adapter) throw new Error(`unknown code-index adapter: ${name}`); return adapter.index(input); }
  manifest() { return [...this.adapters.keys()].sort(); }
}

export class ScipIndexAdapter {
  constructor({ graph } = {}) { if (!graph) throw new Error('graph is required'); this.graph = graph; }

  async index({ repository, sourceSha, index } = {}) {
    if (!repository || !/^[0-9a-f]{40}$/i.test(String(sourceSha ?? ''))) throw new Error('SCIP indexing requires repository and exact sourceSha');
    const docs = index?.documents ?? [];
    const symbolNodes = new Set();
    for (const doc of docs) {
      const path = String(doc.relative_path ?? doc.relativePath ?? ''); if (!path) continue;
      const fid = fileId(repository, path);
      this.graph.upsertNode({ id: fid, kind: 'file', repository, ref: sourceSha, sourceSha, path, language: doc.language ?? null, indexKind: 'scip' });
      for (const occurrence of doc.occurrences ?? []) {
        if (!occurrence.symbol) continue;
        const sid = symbolId(repository, occurrence.symbol); symbolNodes.add(sid);
        this.graph.upsertNode({ id: sid, kind: 'symbol', repository, ref: sourceSha, sourceSha, path, symbol: occurrence.symbol, name: occurrence.displayName ?? null, language: doc.language ?? null, indexKind: 'scip' });
        this.graph.addEdge({ from: fid, to: sid, type: Number(occurrence.symbol_roles ?? occurrence.symbolRoles ?? 0) & 1 ? 'defines' : 'references', metadata: { range: occurrence.range ?? null } });
      }
      for (const info of doc.symbols ?? []) {
        if (!info.symbol) continue;
        const sid = symbolId(repository, info.symbol); symbolNodes.add(sid);
        this.graph.upsertNode({ id: sid, kind: 'symbol', repository, ref: sourceSha, sourceSha, path, symbol: info.symbol, name: info.display_name ?? info.displayName ?? null, signature: info.signature_documentation?.text ?? null, language: doc.language ?? null, indexKind: 'scip' });
        for (const relation of info.relationships ?? []) {
          if (!relation.symbol) continue;
          const target = symbolId(repository, relation.symbol); symbolNodes.add(target);
          this.graph.upsertNode({ id: target, kind: 'symbol', repository, ref: sourceSha, sourceSha, symbol: relation.symbol, indexKind: 'scip' });
          const type = relation.is_implementation || relation.isImplementation ? 'implements' : relation.is_reference || relation.isReference ? 'references' : 'relates';
          this.graph.addEdge({ from: sid, to: target, type });
        }
      }
    }
    return { adapter: 'scip', repository, sourceSha, files: docs.length, symbols: symbolNodes.size, graphNodes: this.graph.nodes.size, graphEdges: this.graph.edges.size };
  }
}

export class ParserIndexAdapter {
  constructor({ graph, parseFile, name = 'parser' } = {}) { if (!graph || typeof parseFile !== 'function') throw new Error('graph and parseFile are required'); this.graph = graph; this.parseFile = parseFile; this.name = name; }

  async index({ repository, sourceSha, files = [] } = {}) {
    if (!repository || !/^[0-9a-f]{40}$/i.test(String(sourceSha ?? ''))) throw new Error('parser indexing requires repository and exact sourceSha');
    let symbols = 0; let references = 0;
    for (const file of files) {
      const path = String(file.path).replaceAll('\\','/'); const fid = fileId(repository, path);
      this.graph.upsertNode({ id: fid, kind: 'file', repository, ref: sourceSha, sourceSha, path, language: file.language ?? null, indexKind: this.name });
      const parsed = await this.parseFile(file);
      for (const symbol of parsed.symbols ?? []) {
        const sid = symbol.id ?? `symbol:${repository}:${path}:${symbol.name}`;
        this.graph.upsertNode({ id: sid, kind: 'symbol', repository, ref: sourceSha, sourceSha, path, name: symbol.name, language: file.language ?? null, range: symbol.range ?? null, indexKind: this.name });
        this.graph.addEdge({ from: fid, to: sid, type: 'defines' }); symbols += 1;
      }
      for (const reference of parsed.references ?? []) {
        if (!reference.targetId) continue;
        if (!this.graph.nodes.has(reference.targetId)) this.graph.upsertNode({ id: reference.targetId, kind: 'symbol', repository, ref: sourceSha, sourceSha, name: reference.targetName ?? null, indexKind: this.name });
        this.graph.addEdge({ from: fid, to: reference.targetId, type: reference.type ?? 'references', metadata: { range: reference.range ?? null } }); references += 1;
      }
    }
    return { adapter: this.name, repository, sourceSha, files: files.length, symbols, references, graphNodes: this.graph.nodes.size, graphEdges: this.graph.edges.size };
  }
}

import path from 'node:path';
import { digest } from './solution-cas.js';

function normalizePath(value) { return String(value).replaceAll('\\', '/'); }
function languageFor(file) {
  const ext = path.extname(file.path ?? '').toLowerCase();
  return file.language ?? ({ '.js':'javascript','.mjs':'javascript','.cjs':'javascript','.ts':'typescript','.tsx':'typescript','.jsx':'javascript','.py':'python','.java':'java','.cs':'csharp','.php':'php','.go':'go','.rs':'rust' }[ext] ?? 'text');
}
function imports(content, language) {
  const rows = [];
  if (['javascript','typescript'].includes(language)) {
    for (const m of content.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|require\s*\()\s*['"]([^'"]+)['"]/g)) rows.push(m[1]);
  } else if (language === 'python') {
    for (const m of content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) rows.push(m[1] ?? m[2]);
  }
  return [...new Set(rows)];
}
function symbols(content, language) {
  const rows = [];
  const patterns = ['javascript','typescript'].includes(language)
    ? [/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,/\bclass\s+([A-Za-z_$][\w$]*)/g,/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g]
    : language === 'python' ? [/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm,/^\s*class\s+([A-Za-z_]\w*)\b/gm] : [];
  for (const pattern of patterns) for (const m of content.matchAll(pattern)) rows.push(m[1]);
  return [...new Set(rows)];
}

export class SourceIndexer {
  constructor({ graph } = {}) { if (!graph) throw new Error('graph is required'); this.graph = graph; }

  index({ repository, ref = 'HEAD', files = [] } = {}) {
    if (!repository) throw new Error('repository is required');
    const byPath = new Map(); const indexed = [];
    for (const file of files) {
      const filePath = normalizePath(file.path); const language = languageFor(file); const content = String(file.content ?? '');
      const fileId = `file:${repository}:${filePath}`; byPath.set(filePath, fileId);
      this.graph.upsertNode({ id: fileId, kind: 'file', repository, ref, path: filePath, language, contentDigest: digest(content) });
      const symbolIds = [];
      for (const name of symbols(content, language)) {
        const id = `symbol:${repository}:${filePath}:${name}`; symbolIds.push(id);
        this.graph.upsertNode({ id, kind: 'symbol', repository, ref, path: filePath, name, language });
        this.graph.addEdge({ from: fileId, to: id, type: 'defines' });
      }
      indexed.push({ fileId, filePath, language, imports: imports(content, language), symbolIds });
    }
    for (const row of indexed) {
      for (const specifier of row.imports) {
        if (!specifier.startsWith('.')) continue;
        const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(row.filePath), specifier)));
        const targets = [base, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}/index.js`, `${base}/index.ts`];
        const targetId = targets.map((candidate) => byPath.get(candidate)).find(Boolean);
        if (targetId) this.graph.addEdge({ from: row.fileId, to: targetId, type: 'imports', metadata: { specifier } });
      }
    }
    return { repository, ref, files: indexed.length, symbols: indexed.reduce((sum, row) => sum + row.symbolIds.length, 0), graphNodes: this.graph.nodes.size, graphEdges: this.graph.edges.size };
  }
}

// Review-lens compiler.
//
// Compiles one full context packet (e.g. a ContextCompiler.compile() result, or
// any {items: [...]} packet) into a set of independent, focused "review lens"
// packets — functional, architecture, security, auth, data/schema, performance,
// dependency/supply-chain, and release/rollback — each carrying only the items
// relevant to that lens instead of the whole packet.
//
// Also provides TokenBudgetInstrumentation, a small before/after token-count
// recorder so lens narrowing (and entropy-driven splitting) can be measured
// instead of asserted. Instrumentation here only ever measures token counts of
// packets this module builds; it makes no claim about downstream eval/acceptance
// quality, which requires a live-traffic measurement harness this PR does not
// build (see PR description).
//
// Deliberately NOT wired into the live dispatch/prompt-building path yet.

function estimateTokens(value) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') / 4);
}

function textOf(item) {
  return [item.path, item.name, item.kind, item.intentTag, item.content, ...(Array.isArray(item.tags) ? item.tags : [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function pathMatches(item, patterns) {
  const path = String(item.path ?? '').toLowerCase();
  return patterns.some((pattern) => path.includes(pattern));
}

function keywordMatches(item, keywords) {
  const haystack = textOf(item);
  return keywords.some((keyword) => haystack.includes(keyword));
}

// Each lens is a pure predicate over an item plus a short description of what
// it selects for. Lenses are independent of one another by construction: an
// item can match multiple lenses (e.g. a schema-migration touching auth tables
// matches both `auth` and `dataSchema`), and each lens is computed against the
// same full item set rather than against a previous lens's output.
export const REVIEW_LENSES = {
  functional: {
    description: 'Core behavior change: the primary diff/feature surface.',
    match: (item) => !item.generated && !item.noise
  },
  architecture: {
    description: 'Structural boundaries: module layout, interfaces, call graph shape.',
    match: (item) =>
      pathMatches(item, ['/interfaces/', '/contracts/', 'index.js', 'index.ts']) ||
      keywordMatches(item, ['architecture', 'interface', 'boundary', 'module-graph'])
  },
  security: {
    description: 'Security-sensitive surface: crypto, secrets, input trust boundaries.',
    match: (item) =>
      pathMatches(item, ['secur', 'crypto', 'secret', 'sanitiz', 'valid']) ||
      keywordMatches(item, ['security', 'vulnerab', 'injection', 'secret', 'crypto', 'sanitize'])
  },
  auth: {
    description: 'Authentication/authorization: identity, session, permission checks.',
    match: (item) =>
      pathMatches(item, ['auth', 'session', 'permission', 'role', 'acl']) ||
      keywordMatches(item, ['auth', 'session', 'permission', 'role', 'token', 'oauth'])
  },
  dataSchema: {
    description: 'Data/schema: persisted shape, migrations, serialization contracts.',
    match: (item) =>
      pathMatches(item, ['schema', 'migrat', 'model', '/db/', 'store']) ||
      keywordMatches(item, ['schema', 'migration', 'column', 'table', 'serializ'])
  },
  performance: {
    description: 'Performance: hot paths, batching, caching, complexity-sensitive code.',
    match: (item) =>
      pathMatches(item, ['cache', 'batch', 'perf', 'index']) ||
      keywordMatches(item, ['performance', 'latency', 'throughput', 'cache', 'n+1', 'complexity'])
  },
  dependencySupplyChain: {
    description: 'Dependency/supply-chain: manifests, lockfiles, third-party adoption.',
    match: (item) =>
      pathMatches(item, ['package.json', 'package-lock', 'requirements.txt', 'go.mod', 'cargo.toml', 'vendor/']) ||
      keywordMatches(item, ['dependency', 'license', 'upstream', 'lockfile', 'supply-chain'])
  },
  releaseRollback: {
    description: 'Release/rollback: deploy config, feature flags, migration reversibility.',
    match: (item) =>
      pathMatches(item, ['deploy', 'release', 'rollback', 'flag', '.github/workflows', 'ci/']) ||
      keywordMatches(item, ['release', 'rollback', 'deploy', 'feature-flag', 'canary'])
  }
};

export const REVIEW_LENS_NAMES = Object.keys(REVIEW_LENSES);

/**
 * In-memory before/after token-count recorder. Records are measurements of
 * packets this process built — not a claim about eval/acceptance quality,
 * which needs real dispatch traffic to measure honestly.
 */
export class TokenBudgetInstrumentation {
  constructor() {
    this.records = [];
  }

  record({ label, before, after, extra = {} } = {}) {
    const tokensBefore = estimateTokens(before);
    const tokensAfter = estimateTokens(after);
    const entry = {
      label: label ?? null,
      tokensBefore,
      tokensAfter,
      reduction: tokensBefore - tokensAfter,
      reductionRatio: tokensBefore > 0 ? Math.round((1 - tokensAfter / tokensBefore) * 1000) / 1000 : 0,
      recordedAt: Date.now(),
      ...extra
    };
    this.records.push(entry);
    return entry;
  }

  summary() {
    if (!this.records.length) return { count: 0, totalBefore: 0, totalAfter: 0, avgReductionRatio: 0 };
    const totalBefore = this.records.reduce((sum, entry) => sum + entry.tokensBefore, 0);
    const totalAfter = this.records.reduce((sum, entry) => sum + entry.tokensAfter, 0);
    const avgReductionRatio = this.records.reduce((sum, entry) => sum + entry.reductionRatio, 0) / this.records.length;
    return {
      count: this.records.length,
      totalBefore,
      totalAfter,
      totalReduction: totalBefore - totalAfter,
      avgReductionRatio: Math.round(avgReductionRatio * 1000) / 1000
    };
  }
}

/**
 * Compiles one lens from a full context packet. `fullPacket` is expected to
 * expose its content as `items` (an array of objects with at least a `path`
 * and/or textual fields); any packet shape lacking `items` is treated as
 * having none, and the lens comes back empty.
 *
 * @param {object} fullPacket
 * @param {string} lensName one of REVIEW_LENS_NAMES
 * @param {{instrumentation?: TokenBudgetInstrumentation}} [options]
 */
export function compileLens(fullPacket = {}, lensName, { instrumentation } = {}) {
  const lens = REVIEW_LENSES[lensName];
  if (!lens) throw new Error(`unknown review lens: ${lensName}`);

  const items = Array.isArray(fullPacket.items) ? fullPacket.items : [];
  const matched = items.filter((item) => lens.match(item));

  const lensPacket = {
    lens: lensName,
    description: lens.description,
    objective: fullPacket.objective ?? null,
    taskClass: fullPacket.taskClass ?? null,
    items: matched,
    stats: {
      totalItems: items.length,
      matchedItems: matched.length,
      narrowedRatio: items.length ? Math.round((1 - matched.length / items.length) * 1000) / 1000 : 0
    }
  };

  if (instrumentation) {
    instrumentation.record({ label: `lens:${lensName}`, before: fullPacket, after: lensPacket, extra: { lens: lensName } });
  }

  return lensPacket;
}

/**
 * Compiles every named review lens (or a caller-supplied subset) from one full
 * packet, returning a map keyed by lens name plus an instrumentation summary.
 *
 * @param {object} fullPacket
 * @param {{lenses?: string[], instrumentation?: TokenBudgetInstrumentation}} [options]
 */
export function compileAllLenses(fullPacket = {}, { lenses = REVIEW_LENS_NAMES, instrumentation = new TokenBudgetInstrumentation() } = {}) {
  const compiled = {};
  for (const lensName of lenses) {
    compiled[lensName] = compileLens(fullPacket, lensName, { instrumentation });
  }
  return { lenses: compiled, instrumentation, summary: instrumentation.summary() };
}

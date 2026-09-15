import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_LENS_NAMES,
  compileLens,
  compileAllLenses,
  TokenBudgetInstrumentation
} from '../src/leverage/review-lens-compiler.js';

function fullPacket() {
  return {
    objective: 'ship rate-limited login with a new sessions table',
    taskClass: 'coding',
    items: [
      { path: 'src/auth/session.js', content: 'export function createSession(user) { /* issues auth token */ }' },
      { path: 'src/auth/login.js', content: 'validates credentials and calls createSession, checks role permission' },
      { path: 'src/db/migrations/003-sessions-table.sql', content: 'CREATE TABLE sessions (id, user_id, expires_at)' },
      { path: 'src/net/rate-limiter.js', content: 'token bucket cache for login throughput, avoids n+1 lookups' },
      { path: 'src/security/input-validator.js', content: 'sanitizes request bodies to prevent injection' },
      { path: 'package.json', content: '{"dependencies": {"left-pad": "^1.0.0"}}' },
      { path: '.github/workflows/deploy.yml', content: 'canary rollback steps for release' },
      { path: 'src/ui/LoginForm.jsx', content: 'renders a plain html form with labeled input fields' },
      { path: 'README.md', content: 'project overview' }
    ]
  };
}

test('REVIEW_LENS_NAMES exposes all eight named lenses', () => {
  assert.deepEqual(new Set(REVIEW_LENS_NAMES), new Set([
    'functional', 'architecture', 'security', 'auth', 'dataSchema',
    'performance', 'dependencySupplyChain', 'releaseRollback'
  ]));
});

test('compileLens narrows the security lens to security-relevant items only', () => {
  const packet = fullPacket();
  const security = compileLens(packet, 'security');
  const paths = security.items.map((item) => item.path);
  assert.ok(paths.length < packet.items.length, 'security lens should narrow relative to full packet');
  assert.ok(paths.includes('src/security/input-validator.js'));
  assert.ok(!paths.includes('README.md'));
  assert.ok(!paths.includes('src/ui/LoginForm.jsx'));
});

test('compileLens auth lens captures auth-specific items distinct from the security lens output', () => {
  const packet = fullPacket();
  const auth = compileLens(packet, 'auth');
  const authPaths = auth.items.map((item) => item.path);
  assert.ok(authPaths.includes('src/auth/session.js'));
  assert.ok(authPaths.includes('src/auth/login.js'));
});

test('compileLens throws on an unknown lens name', () => {
  assert.throws(() => compileLens(fullPacket(), 'not-a-lens'), /unknown review lens/);
});

test('compileAllLenses produces every lens and each narrows tokens relative to the full packet', () => {
  const packet = fullPacket();
  const { lenses, summary, instrumentation } = compileAllLenses(packet);

  assert.equal(Object.keys(lenses).length, REVIEW_LENS_NAMES.length);
  assert.equal(instrumentation.records.length, REVIEW_LENS_NAMES.length);

  // Non-functional lenses (which intentionally keep only non-generated items,
  // i.e. nearly everything) should each measurably narrow context relative to
  // the full packet's token count.
  const narrowingLenses = REVIEW_LENS_NAMES.filter((name) => name !== 'functional');
  for (const name of narrowingLenses) {
    const record = instrumentation.records.find((entry) => entry.lens === name);
    assert.ok(record, `expected an instrumentation record for lens ${name}`);
    assert.ok(record.tokensAfter <= record.tokensBefore,
      `lens ${name} should not grow tokens (${record.tokensAfter} > ${record.tokensBefore})`);
    assert.ok(record.tokensAfter < record.tokensBefore,
      `lens ${name} should strictly narrow tokens relative to the full packet`);
  }

  assert.equal(summary.count, REVIEW_LENS_NAMES.length);
  assert.ok(summary.avgReductionRatio > 0, 'average reduction ratio across lenses should be positive');
});

test('TokenBudgetInstrumentation records honest before/after token deltas without fabricating quality claims', () => {
  const instrumentation = new TokenBudgetInstrumentation();
  const before = { items: new Array(20).fill({ path: 'x', content: 'y'.repeat(200) }) };
  const after = { items: before.items.slice(0, 2) };
  const entry = instrumentation.record({ label: 'manual-narrow', before, after });

  assert.ok(entry.tokensBefore > entry.tokensAfter);
  assert.equal(entry.reduction, entry.tokensBefore - entry.tokensAfter);
  assert.ok(entry.reductionRatio > 0.5);

  const summary = instrumentation.summary();
  assert.equal(summary.count, 1);
  assert.equal(summary.totalReduction, entry.reduction);
});

test('TokenBudgetInstrumentation summary on no records is inert, not fabricated', () => {
  const instrumentation = new TokenBudgetInstrumentation();
  assert.deepEqual(instrumentation.summary(), { count: 0, totalBefore: 0, totalAfter: 0, avgReductionRatio: 0 });
});

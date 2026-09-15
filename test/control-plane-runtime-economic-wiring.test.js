import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { TaskState } from '../src/core/task-graph.js';
import { readOutcomeLog } from '../src/training/outcome-store.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('ControlPlaneRuntime wires the economic gate and outcome recorder live by default', () => {
  const runtime = new ControlPlaneRuntime({ outcomeLogPath: null });
  assert.ok(runtime.riskClassifier, 'MergeRiskClassifier must be wired by default');
  assert.ok(runtime.economicVerifier, 'EconomicVerifier must be wired by default');
  assert.equal(runtime.orchestrator.riskClassifier, runtime.riskClassifier);
  assert.equal(runtime.orchestrator.economicVerifier, runtime.economicVerifier);
});

test('ControlPlaneRuntime.complete fails closed on a real C3+ merge with no economic certificate', () => {
  const runtime = new ControlPlaneRuntime({ outcomeLogPath: null });
  runtime.graph.add({ key: 't1', repository: 'go2max/demo', metadata: { execution: { ref: SHA_A, kind: 'coding-agent' } } });
  const [dispatch] = runtime.orchestrator.dispatch([{ workerId: 'w1', capabilities: [], capacity: { freeSlots: 1 }, pressure: {}, metadata: {} }], { now: 1000 });
  const result = runtime.complete({
    taskKey: 't1', claim: dispatch.claim,
    acceptance: { requiredChecks: ['tests'] },
    evidence: { producerId: 'agent-1', verifierId: 'verifier-1', checks: { tests: { ok: true } }, artifacts: { commitSha: SHA_B, changedPaths: ['src/billing/charge-card.js'] } }
  }, { now: 1001 });
  assert.equal(result.task.state, TaskState.BLOCKED);
  assert.equal(result.decision.action, 'ECONOMIC_REJECT');
});

test('ControlPlaneRuntime writes live accepted-outcome trajectories to its default outcome log path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cprt-outcomes-'));
  const logPath = join(dir, 'outcomes.jsonl');
  try {
    const runtime = new ControlPlaneRuntime({ outcomeLogPath: logPath });
    runtime.graph.add({ key: 't1', repository: 'go2max/demo' });
    const [dispatch] = runtime.orchestrator.dispatch([{ workerId: 'w1', capabilities: [], capacity: { freeSlots: 1 }, pressure: {}, metadata: {} }], { now: 1000 });
    runtime.complete({ taskKey: 't1', claim: dispatch.claim, acceptance: { requiredChecks: ['tests'] }, evidence: { checks: { tests: { ok: true } } } }, { now: 1001 });
    const records = readOutcomeLog(logPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].finalAcceptance, 'accepted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

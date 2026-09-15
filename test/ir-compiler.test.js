import test from 'node:test';
import assert from 'node:assert/strict';
import { compileIntent, verifyWorkIRIntegrity } from '../src/ir/compiler.js';
import { OperationType } from '../src/ir/operation-types.js';

function baseOps() {
  return [
    {
      id: 'add-endpoint',
      type: OperationType.CREATE_ARTIFACT,
      intent: 'add /health endpoint',
      target: { repository: 'go2max/demo', artifactPath: 'src/health.js' },
      mutationScope: ['src/health.js']
    },
    {
      id: 'wire-endpoint',
      type: OperationType.MODIFY_CONTRACT,
      intent: 'wire /health into router',
      target: { repository: 'go2max/demo', contract: 'router' },
      mutationScope: ['src/router.js'],
      dependsOn: ['add-endpoint']
    },
    {
      id: 'validate-release',
      type: OperationType.VALIDATE_RELEASE,
      intent: 'validate the release',
      target: { repository: 'go2max/demo', releaseKey: 'demo-r1' },
      dependsOn: ['wire-endpoint']
    }
  ];
}

test('compileIntent produces a hashed, versioned work IR with resolved capability/risk/verification/release plans', () => {
  const ir = compileIntent({ irKey: 'issue-97-demo', operations: baseOps() });

  assert.equal(ir.schema, 'maxxed.engineering-ir.v1');
  assert.equal(ir.irKey, 'issue-97-demo');
  assert.equal(typeof ir.hash, 'string');
  assert.equal(ir.hash.length, 64);
  assert.equal(ir.operations.length, 3);

  const add = ir.operations.find((op) => op.id === 'add-endpoint');
  assert.equal(add.capability, 'coding-agent');
  assert.equal(add.riskClass, 'normal');
  assert.deepEqual(add.verification.requiredChecks, [`verify:${OperationType.CREATE_ARTIFACT}:add-endpoint`]);

  const validate = ir.operations.find((op) => op.id === 'validate-release');
  assert.equal(validate.capability, 'verifier-agent');
  assert.equal(validate.riskClass, 'high'); // risk floor for ValidateRelease
  assert.equal(validate.verification.requireIndependentVerifier, true);

  assert.deepEqual(ir.dependencyGraph['wire-endpoint'], ['add-endpoint']);
  assert.deepEqual(ir.dependencyGraph['validate-release'], ['wire-endpoint']);
});

test('compileIntent is deterministic: same operations hash identically regardless of input order', () => {
  const ops = baseOps();
  const a = compileIntent({ irKey: 'k', operations: ops });
  const b = compileIntent({ irKey: 'k', operations: [...ops].reverse() });
  assert.equal(a.hash, b.hash);
});

test('compileIntent rejects dependency cycles', () => {
  const ops = [
    { id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' }, mutationScope: ['a.js'], dependsOn: ['b'] },
    { id: 'b', type: OperationType.CREATE_ARTIFACT, intent: 'b', target: { repository: 'go2max/demo', artifactPath: 'b.js' }, mutationScope: ['b.js'], dependsOn: ['a'] }
  ];
  assert.throws(() => compileIntent({ irKey: 'cyclic', operations: ops }), /dependency cycle/);
});

test('compileIntent rejects unknown dependsOn references, duplicate ids, and self-deps', () => {
  assert.throws(() => compileIntent({
    irKey: 'k',
    operations: [{ id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' }, mutationScope: ['a.js'], dependsOn: ['missing'] }]
  }), /references unknown operation/);

  assert.throws(() => compileIntent({
    irKey: 'k',
    operations: [
      { id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' }, mutationScope: ['a.js'] },
      { id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a2', target: { repository: 'go2max/demo', artifactPath: 'a2.js' }, mutationScope: ['a2.js'] }
    ]
  }), /duplicate operation id/);

  assert.throws(() => compileIntent({
    irKey: 'k',
    operations: [{ id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' }, mutationScope: ['a.js'], dependsOn: ['a'] }]
  }), /cannot depend on itself/);
});

test('compileIntent requires mutationScope for mutating operation types but not ValidateRelease', () => {
  assert.throws(() => compileIntent({
    irKey: 'k',
    operations: [{ id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'a', target: { repository: 'go2max/demo', artifactPath: 'a.js' } }]
  }), /mutationScope is required/);

  const ir = compileIntent({
    irKey: 'k',
    operations: [{ id: 'v', type: OperationType.VALIDATE_RELEASE, intent: 'validate', target: { repository: 'go2max/demo', releaseKey: 'r1' } }]
  });
  assert.equal(ir.operations[0].mutationScope.length, 0);
});

test('compileIntent rejects empty irKey or empty operations', () => {
  assert.throws(() => compileIntent({ irKey: '', operations: baseOps() }), /irKey is required/);
  assert.throws(() => compileIntent({ irKey: 'k', operations: [] }), /non-empty array/);
  assert.throws(() => compileIntent({ irKey: 'k' }), /non-empty array/);
});

test('verifyWorkIRIntegrity detects tampering and validates a freshly compiled IR', () => {
  const ir = compileIntent({ irKey: 'issue-97-demo', operations: baseOps() });
  assert.deepEqual(verifyWorkIRIntegrity(ir), { valid: true, reason: null });

  const tampered = structuredClone(ir);
  tampered.operations[0].riskClass = 'critical';
  const result = verifyWorkIRIntegrity(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'hash-mismatch');

  assert.equal(verifyWorkIRIntegrity({ schema: 'wrong' }).valid, false);
});

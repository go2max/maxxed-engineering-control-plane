import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OperationType,
  isKnownOperationType,
  capabilityForOperationType,
  riskFloorForOperationType,
  resolveOperationRisk,
  assertValidOperation
} from '../src/ir/operation-types.js';

test('all nine required IR operation types are defined', () => {
  const expected = [
    'ChangeCapability', 'CreateArtifact', 'ModifyContract', 'RepairFailure', 'MigrateSchema',
    'PropagateBaseline', 'DeprecateComponent', 'ValidateRelease', 'ChangeAuthorizationBoundary'
  ];
  assert.deepEqual(Object.values(OperationType).sort(), expected.sort());
  for (const type of expected) assert.equal(isKnownOperationType(type), true);
  assert.equal(isKnownOperationType('NotARealType'), false);
});

test('capability resolution is deterministic per type', () => {
  assert.equal(capabilityForOperationType(OperationType.CHANGE_CAPABILITY), 'coding-agent');
  assert.equal(capabilityForOperationType(OperationType.VALIDATE_RELEASE), 'verifier-agent');
  assert.throws(() => capabilityForOperationType('bogus'), /unknown IR operation type/);
});

test('risk floors are enforced and cannot be lowered', () => {
  assert.equal(riskFloorForOperationType(OperationType.CHANGE_AUTHORIZATION_BOUNDARY), 'critical');
  assert.equal(riskFloorForOperationType(OperationType.MIGRATE_SCHEMA), 'high');
  assert.equal(riskFloorForOperationType(OperationType.CREATE_ARTIFACT), 'normal');

  assert.equal(resolveOperationRisk(OperationType.CHANGE_AUTHORIZATION_BOUNDARY, 'normal'), 'critical');
  assert.equal(resolveOperationRisk(OperationType.MIGRATE_SCHEMA, 'normal'), 'high');
  assert.equal(resolveOperationRisk(OperationType.MIGRATE_SCHEMA, 'critical'), 'critical');
  assert.equal(resolveOperationRisk(OperationType.CREATE_ARTIFACT, 'normal'), 'normal');
  assert.throws(() => resolveOperationRisk(OperationType.CREATE_ARTIFACT, 'nonsense'), /unknown riskClass/);
});

test('assertValidOperation enforces per-type required target fields', () => {
  const base = { id: 'op-1', intent: 'do the thing', target: { repository: 'go2max/demo' } };

  assert.throws(() => assertValidOperation({ ...base, type: OperationType.CHANGE_CAPABILITY }), /requires target.capability/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.CREATE_ARTIFACT }), /requires target.artifactPath/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.MODIFY_CONTRACT }), /requires target.contract/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.REPAIR_FAILURE }), /requires target.failureFingerprint/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.MIGRATE_SCHEMA }), /requires target.schema/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.PROPAGATE_BASELINE }), /requires target.baselineKey/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.DEPRECATE_COMPONENT }), /requires target.component/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.VALIDATE_RELEASE }), /requires target.releaseKey/);
  assert.throws(() => assertValidOperation({ ...base, type: OperationType.CHANGE_AUTHORIZATION_BOUNDARY }), /requires target.boundary/);

  assert.doesNotThrow(() => assertValidOperation({
    ...base, type: OperationType.CREATE_ARTIFACT, target: { repository: 'go2max/demo', artifactPath: 'src/x.js' }
  }));
});

test('assertValidOperation rejects malformed core fields', () => {
  assert.throws(() => assertValidOperation(null), /must be an object/);
  assert.throws(() => assertValidOperation({}), /operation.id is required/);
  assert.throws(() => assertValidOperation({ id: 'a', type: 'bogus' }), /unknown type/);
  assert.throws(() => assertValidOperation({ id: 'a', type: OperationType.CREATE_ARTIFACT }), /intent .* is required/);
  assert.throws(() => assertValidOperation({
    id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'x', target: { repository: 'not-a-repo' }
  }), /owner\/name/);
  assert.throws(() => assertValidOperation({
    id: 'a', type: OperationType.CREATE_ARTIFACT, intent: 'x', target: { repository: 'go2max/demo', artifactPath: 'x' }, riskClass: 'weird'
  }), /unknown riskClass/);
});

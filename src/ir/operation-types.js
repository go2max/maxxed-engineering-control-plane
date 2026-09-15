// Engineering IR operation taxonomy (issue #97).
//
// This is the versioned, typed vocabulary of "what can change" that the compiler resolves
// intent into, instead of agents re-deriving operation semantics from prose on every task.
// Adding a new operation type is a deliberate, reviewed edit to this file (and a version bump
// when the *shape* of an existing type changes), never an ad hoc field an agent invents.

export const IR_SCHEMA_VERSION = 'maxxed.engineering-ir.v1';

export const OperationType = Object.freeze({
  CHANGE_CAPABILITY: 'ChangeCapability',
  CREATE_ARTIFACT: 'CreateArtifact',
  MODIFY_CONTRACT: 'ModifyContract',
  REPAIR_FAILURE: 'RepairFailure',
  MIGRATE_SCHEMA: 'MigrateSchema',
  PROPAGATE_BASELINE: 'PropagateBaseline',
  DEPRECATE_COMPONENT: 'DeprecateComponent',
  VALIDATE_RELEASE: 'ValidateRelease',
  CHANGE_AUTHORIZATION_BOUNDARY: 'ChangeAuthorizationBoundary'
});

const ALL_OPERATION_TYPES = new Set(Object.values(OperationType));

// Per-type capability requirement: what kind of executor/dispatch capability the compiler
// must resolve for an operation of this type. This is the deterministic rule that previously
// lived only in an agent's/prompt's head.
const CAPABILITY_BY_TYPE = Object.freeze({
  [OperationType.CHANGE_CAPABILITY]: 'coding-agent',
  [OperationType.CREATE_ARTIFACT]: 'coding-agent',
  [OperationType.MODIFY_CONTRACT]: 'coding-agent',
  [OperationType.REPAIR_FAILURE]: 'coding-agent',
  [OperationType.MIGRATE_SCHEMA]: 'coding-agent',
  [OperationType.PROPAGATE_BASELINE]: 'coding-agent',
  [OperationType.DEPRECATE_COMPONENT]: 'coding-agent',
  [OperationType.VALIDATE_RELEASE]: 'verifier-agent',
  [OperationType.CHANGE_AUTHORIZATION_BOUNDARY]: 'coding-agent'
});

// Per-type default risk floor: some operation types are never "normal" risk regardless of what
// the caller passes, because their blast radius is structurally larger (auth boundaries, schema
// migrations, release validation gates). The compiler enforces the floor; callers may only raise
// risk, never lower it below the floor.
const RISK_FLOOR_BY_TYPE = Object.freeze({
  [OperationType.CHANGE_AUTHORIZATION_BOUNDARY]: 'critical',
  [OperationType.MIGRATE_SCHEMA]: 'high',
  [OperationType.VALIDATE_RELEASE]: 'high'
});

const RISK_ORDER = ['normal', 'high', 'critical'];

function riskAtLeast(risk, floor) {
  return RISK_ORDER.indexOf(risk) >= RISK_ORDER.indexOf(floor);
}

export function isKnownOperationType(type) {
  return ALL_OPERATION_TYPES.has(type);
}

export function capabilityForOperationType(type) {
  const capability = CAPABILITY_BY_TYPE[type];
  if (!capability) throw new Error(`unknown IR operation type: ${type}`);
  return capability;
}

export function riskFloorForOperationType(type) {
  return RISK_FLOOR_BY_TYPE[type] ?? 'normal';
}

export function resolveOperationRisk(type, requestedRisk = 'normal') {
  const floor = riskFloorForOperationType(type);
  if (!RISK_ORDER.includes(requestedRisk)) throw new Error(`unknown riskClass: ${requestedRisk}`);
  return riskAtLeast(requestedRisk, floor) ? requestedRisk : floor;
}

/**
 * Validate a single raw operation against the required shape for its declared type.
 * Throws a descriptive Error on the first violation; returns nothing on success.
 */
export function assertValidOperation(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('operation must be an object');
  if (!raw.id || typeof raw.id !== 'string') throw new Error('operation.id is required and must be a string');
  if (!isKnownOperationType(raw.type)) throw new Error(`operation ${raw.id}: unknown type ${raw.type}`);
  if (!raw.intent || typeof raw.intent !== 'string') throw new Error(`operation ${raw.id}: intent (human-readable) is required`);
  if (!raw.target || typeof raw.target !== 'object') throw new Error(`operation ${raw.id}: target is required`);
  if (!raw.target.repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(raw.target.repository))) {
    throw new Error(`operation ${raw.id}: target.repository must be owner/name`);
  }
  if (raw.dependsOn != null && !Array.isArray(raw.dependsOn)) throw new Error(`operation ${raw.id}: dependsOn must be an array when supplied`);
  if (raw.mutationScope != null && !Array.isArray(raw.mutationScope)) throw new Error(`operation ${raw.id}: mutationScope must be an array when supplied`);
  if (raw.riskClass != null && !RISK_ORDER.includes(raw.riskClass)) throw new Error(`operation ${raw.id}: unknown riskClass ${raw.riskClass}`);

  // Type-specific required fields — the concrete part of the taxonomy: each operation type
  // guarantees a minimum set of facts is present before the compiler will resolve it further.
  switch (raw.type) {
    case OperationType.CHANGE_CAPABILITY:
      if (!raw.target.capability) throw new Error(`operation ${raw.id}: ChangeCapability requires target.capability`);
      break;
    case OperationType.CREATE_ARTIFACT:
      if (!raw.target.artifactPath) throw new Error(`operation ${raw.id}: CreateArtifact requires target.artifactPath`);
      break;
    case OperationType.MODIFY_CONTRACT:
      if (!raw.target.contract) throw new Error(`operation ${raw.id}: ModifyContract requires target.contract`);
      break;
    case OperationType.REPAIR_FAILURE:
      if (!raw.target.failureFingerprint) throw new Error(`operation ${raw.id}: RepairFailure requires target.failureFingerprint`);
      break;
    case OperationType.MIGRATE_SCHEMA:
      if (!raw.target.schema) throw new Error(`operation ${raw.id}: MigrateSchema requires target.schema`);
      break;
    case OperationType.PROPAGATE_BASELINE:
      if (!raw.target.baselineKey) throw new Error(`operation ${raw.id}: PropagateBaseline requires target.baselineKey`);
      break;
    case OperationType.DEPRECATE_COMPONENT:
      if (!raw.target.component) throw new Error(`operation ${raw.id}: DeprecateComponent requires target.component`);
      break;
    case OperationType.VALIDATE_RELEASE:
      if (!raw.target.releaseKey) throw new Error(`operation ${raw.id}: ValidateRelease requires target.releaseKey`);
      break;
    case OperationType.CHANGE_AUTHORIZATION_BOUNDARY:
      if (!raw.target.boundary) throw new Error(`operation ${raw.id}: ChangeAuthorizationBoundary requires target.boundary`);
      break;
    default:
      throw new Error(`operation ${raw.id}: unhandled type ${raw.type}`);
  }
}

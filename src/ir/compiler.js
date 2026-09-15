// Engineering IR compiler (issue #97).
//
// Deterministic pipeline: intent -> intent IR -> capability resolution -> dependency graph ->
// work IR (hashed/versioned, with execution/verification/release plans attached per operation).
//
// Scope note (see PR body for the full deferral list): this compiler formalizes the typed
// pipeline and produces a hashed, versioned work IR. It intentionally does NOT parse freeform
// prose into operations — that step still requires reasoning and stays an agent/human
// responsibility upstream of this module. What used to be *deterministic* prompt rules
// (capability resolution, risk floors, dependency-graph construction/cycle detection, default
// verification plans) now lives here in code instead of being re-derived from prose per task.

import { digest } from '../leverage/solution-cas.js';
import {
  IR_SCHEMA_VERSION,
  OperationType,
  assertValidOperation,
  capabilityForOperationType,
  resolveOperationRisk
} from './operation-types.js';

function defaultVerificationPlan(type, raw) {
  const requested = raw.verification ?? {};
  const requiredChecks = Array.isArray(requested.requiredChecks) ? [...requested.requiredChecks] : [];
  // Deterministic default: every operation gets at least one check unless the caller supplied
  // its own; ValidateRelease and boundary/schema changes always require an independent verifier.
  if (requiredChecks.length === 0) requiredChecks.push(`verify:${type}:${raw.id}`);
  const highStakes = [
    OperationType.VALIDATE_RELEASE,
    OperationType.MIGRATE_SCHEMA,
    OperationType.CHANGE_AUTHORIZATION_BOUNDARY
  ].includes(type);
  return {
    requiredChecks,
    requireIndependentVerifier: requested.requireIndependentVerifier === true || highStakes
  };
}

function defaultReleasePlan(type, raw) {
  const requested = raw.release ?? {};
  const requiresHumanGate = requested.requiresHumanGate === true
    || type === OperationType.CHANGE_AUTHORIZATION_BOUNDARY
    || type === OperationType.DEPRECATE_COMPONENT;
  return { requiresHumanGate };
}

function assertAcyclic(operationsById) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`IR dependency cycle detected at ${[...path, id].join(' -> ')}`);
    visiting.add(id);
    const op = operationsById.get(id);
    for (const dep of op.dependsOn) visit(dep, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of operationsById.keys()) visit(id, []);
}

/**
 * Compile a batch of typed intent operations into a hashed, versioned work IR.
 *
 * @param {object} input
 * @param {string} input.irKey - stable identifier for this compiled plan (e.g. issue/epic key).
 * @param {Array<object>} input.operations - raw typed operations (see operation-types.js).
 * @returns {object} work IR: { schema, irKey, hash, operations, dependencyGraph }
 */
export function compileIntent({ irKey, operations } = {}) {
  if (!irKey || typeof irKey !== 'string') throw new Error('irKey is required');
  if (!Array.isArray(operations) || operations.length === 0) throw new Error('operations must be a non-empty array');

  const seenIds = new Set();
  for (const raw of operations) {
    assertValidOperation(raw);
    if (seenIds.has(raw.id)) throw new Error(`duplicate operation id: ${raw.id}`);
    seenIds.add(raw.id);
  }

  const operationsById = new Map();
  for (const raw of operations) {
    const dependsOn = [...new Set(raw.dependsOn ?? [])];
    for (const dep of dependsOn) {
      if (!seenIds.has(dep)) throw new Error(`operation ${raw.id}: dependsOn references unknown operation ${dep}`);
      if (dep === raw.id) throw new Error(`operation ${raw.id}: cannot depend on itself`);
    }
    const mutationScope = [...new Set(raw.mutationScope ?? [])];
    const riskClass = resolveOperationRisk(raw.type, raw.riskClass ?? 'normal');
    const capability = capabilityForOperationType(raw.type);
    const compiled = {
      id: raw.id,
      type: raw.type,
      intent: raw.intent,
      target: structuredClone(raw.target),
      capability,
      mutationScope,
      dependsOn,
      riskClass,
      verification: defaultVerificationPlan(raw.type, raw),
      release: defaultReleasePlan(raw.type, raw),
      metadata: raw.metadata ? structuredClone(raw.metadata) : {}
    };
    operationsById.set(raw.id, compiled);
  }

  // Capability resolution invariant: mutation scope is mandatory for anything that actually
  // changes code/state (everything except ValidateRelease, which only reads/checks).
  for (const op of operationsById.values()) {
    if (op.type !== OperationType.VALIDATE_RELEASE && op.mutationScope.length === 0) {
      throw new Error(`operation ${op.id}: mutationScope is required for type ${op.type}`);
    }
  }

  assertAcyclic(operationsById);

  const compiledOperations = [...operationsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const dependencyGraph = Object.fromEntries(compiledOperations.map((op) => [op.id, op.dependsOn]));

  const hashable = { schema: IR_SCHEMA_VERSION, irKey, operations: compiledOperations };
  const hash = digest(hashable);

  return {
    schema: IR_SCHEMA_VERSION,
    irKey,
    hash,
    operations: compiledOperations,
    dependencyGraph
  };
}

/**
 * Recompute the hash of an already-compiled work IR and compare it against the stored hash.
 * Used to bind evidence/outcomes to an exact compiled plan and detect drift (issue #97's
 * "hash/version compiled IR and bind evidence/outcomes to it").
 */
export function verifyWorkIRIntegrity(workIR) {
  if (!workIR || workIR.schema !== IR_SCHEMA_VERSION) return { valid: false, reason: 'unsupported-schema' };
  const recomputed = digest({ schema: workIR.schema, irKey: workIR.irKey, operations: workIR.operations });
  if (recomputed !== workIR.hash) return { valid: false, reason: 'hash-mismatch', expected: workIR.hash, actual: recomputed };
  return { valid: true, reason: null };
}

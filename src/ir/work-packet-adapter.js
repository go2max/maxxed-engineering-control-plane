// Backward adapter: compiled Engineering IR (work IR) -> existing task-graph / work-packet
// shape (issue #97's "provide backward adapter for current work packets" requirement).
//
// This module is deliberately additive: it does not touch TaskGraph, compileCodingTask, the
// scheduler, or scheduler/work-packet-adapter.js. It only produces task inputs that those
// existing systems already understand, so the IR compiler can be adopted incrementally without
// retiring or duplicating the live dispatch path. Wiring this adapter's output into the live
// scheduler/dispatch loop, and retiring any duplicated prose-only planning path, is explicitly
// deferred to a follow-up PR (see this PR's body).

import { TaskStage } from '../scheduler/task-stage.js';
import { WORK_PACKET_SCHEMA } from '../scheduler/work-packet-adapter.js';
import { verifyWorkIRIntegrity } from './compiler.js';
import { OperationType } from './operation-types.js';

function slug(value) {
  return String(value ?? 'op').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'op';
}

function taskKeyFor(irKey, operationId) {
  return `${irKey}:${slug(operationId)}`;
}

function stageForOperationType(type) {
  if (type === OperationType.VALIDATE_RELEASE) return TaskStage.VERIFICATION;
  if (type === OperationType.REPAIR_FAILURE) return TaskStage.REPAIR;
  return TaskStage.IMPLEMENTATION;
}

/**
 * Compile a hashed/versioned work IR into a flat list of task-graph-compatible task inputs
 * (consumable by TaskGraph#add / TaskGraph#upsert), grouped into backward-compatible work
 * packets per repository per scheduler/work-packet-adapter.js's WORK_PACKET_SCHEMA contract.
 *
 * @param {object} workIR - output of compiler.js#compileIntent
 * @param {object} [options]
 * @param {string} [options.baseCommit] - shared base commit for produced work packets, if known
 * @param {string} [options.branchPrefix]
 * @returns {{ tasks: Array<object>, workPackets: Array<object> }}
 */
export function compileWorkIRToTasks(workIR, { baseCommit = null, branchPrefix = 'maxxed/ir' } = {}) {
  const integrity = verifyWorkIRIntegrity(workIR);
  if (!integrity.valid) throw new Error(`refusing to adapt work IR with invalid hash: ${integrity.reason}`);

  const byRepository = new Map();
  for (const op of workIR.operations) {
    const repository = op.target.repository;
    if (!byRepository.has(repository)) byRepository.set(repository, []);
    byRepository.get(repository).push(op);
  }

  const tasks = [];
  const workPackets = [];

  for (const [repository, ops] of byRepository) {
    const memberTaskIds = ops.map((op) => taskKeyFor(workIR.irKey, op.id));
    const packetKey = `ir:${workIR.irKey}:${slug(repository)}`;
    const packetDependencies = [...new Set(
      ops.flatMap((op) => op.dependsOn)
        .map((depId) => taskKeyFor(workIR.irKey, depId))
        .filter((depKey) => !memberTaskIds.includes(depKey))
    )];
    const packetRiskClass = ops.some((op) => op.riskClass === 'critical')
      ? 'critical'
      : ops.some((op) => op.riskClass === 'high') ? 'high' : 'normal';
    const branch = `${branchPrefix}/${slug(workIR.irKey)}/${slug(repository)}`;

    const workPacket = {
      schema: WORK_PACKET_SCHEMA,
      formed: true,
      packetKey,
      repository: repository.toLowerCase(),
      scope: [...new Set(ops.flatMap((op) => op.mutationScope))].join(','),
      memberTaskIds,
      dependencies: packetDependencies,
      riskClass: packetRiskClass,
      baseCommit,
      branch,
      validationTiers: null,
      rollbackStrategy: null
    };
    workPackets.push(workPacket);

    for (const op of ops) {
      const key = taskKeyFor(workIR.irKey, op.id);
      const dependencies = op.dependsOn.map((depId) => taskKeyFor(workIR.irKey, depId));
      const humanGates = op.release.requiresHumanGate ? [`ir:${workIR.irKey}:${op.id}:release-gate`] : [];

      tasks.push({
        key,
        repository,
        objective: op.intent,
        dependencies,
        humanGates,
        riskClass: op.riskClass,
        taskClass: 'ir-compiled',
        requirements: { capabilities: [op.capability], minMemoryMb: 2048 },
        dedupeKey: `ir:${workIR.irKey}:${op.id}`,
        state: 'PLANNED',
        metadata: {
          stage: stageForOperationType(op.type),
          priority: 0,
          restartable: true,
          mutationScopes: [`repo:${repository}`, ...op.mutationScope],
          acceptance: {
            requiredChecks: op.verification.requiredChecks,
            requireIndependentVerifier: op.verification.requireIndependentVerifier
          },
          workPacket,
          ir: {
            irKey: workIR.irKey,
            hash: workIR.hash,
            operationId: op.id,
            operationType: op.type,
            target: structuredClone(op.target)
          }
        }
      });
    }
  }

  return { tasks, workPackets };
}

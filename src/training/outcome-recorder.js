// Live wiring glue between OutcomeStore (issue #71) and the real task-completion path in
// src/core/orchestrator.js.
//
// This is intentionally a thin adapter: all redaction/validation/labeling authority stays in
// outcome-store.js. OutcomeRecorder's only job is (a) shaping an accepted/rejected trajectory out
// of exactly what the orchestrator already has in hand at completion time, and (b) making sure a
// problem while persisting an outcome record (bad shape, disk error) can never itself change or
// block a real accept/reject decision -- outcome recording is observational, not authoritative.

import { buildTrajectoryRecord, appendOutcomeRecord } from './outcome-store.js';

export class OutcomeRecorder {
  constructor({ logPath, now, idGenerator } = {}) {
    if (!logPath) throw new Error('OutcomeRecorder requires a logPath');
    this.logPath = logPath;
    this.now = now;
    this.idGenerator = idGenerator;
  }

  /**
   * Build, validate and persist one trajectory record. Never throws: a shaping/validation/disk
   * failure is reported back via { persisted: false, error } instead of propagating, so a
   * learning-store problem can never take down or alter the real accept/reject path that calls it.
   */
  record(raw, { counterfactualSignals } = {}) {
    try {
      const record = buildTrajectoryRecord(raw, {
        counterfactualSignals,
        ...(this.now ? { now: this.now } : {}),
        ...(this.idGenerator ? { idGenerator: this.idGenerator } : {})
      });
      appendOutcomeRecord(record, this.logPath);
      return { persisted: true, record };
    } catch (error) {
      return { persisted: false, error: error.message };
    }
  }
}

/**
 * Shape a raw trajectory record from the objects the orchestrator already has at task-completion
 * time. Pure function so it is trivially testable without touching the filesystem.
 */
export function trajectoryFromCompletion({ task, claim, evidence, verification, finalAcceptance, economicGate, startedAt, now = Date.now() } = {}) {
  const verifierOutcomes = [
    { name: 'functional-verifier', verdict: verification?.verdict === 'PASS' ? 'pass' : 'fail', detail: verification?.reason ?? null }
  ];
  if (economicGate) {
    verifierOutcomes.push({
      name: 'economic-verifier',
      verdict: economicGate.verdict?.verdict === 'ACCEPT' ? 'pass' : 'fail',
      detail: economicGate.verdict?.reason ?? null,
      escapedToProduction: false
    });
  }

  const raw = {
    taskClass: task?.taskClass ?? 'standard',
    sourceFingerprint: task?.metadata?.execution?.ref ?? evidence?.artifacts?.commitSha ?? task?.key ?? 'unknown',
    executor: {
      id: evidence?.producerId ?? claim?.ownerId ?? 'unknown',
      model: evidence?.model ?? task?.metadata?.modelRequest?.model ?? 'unspecified',
      kind: task?.metadata?.execution?.kind ?? 'task'
    },
    finalAcceptance,
    verifierOutcomes,
    summary: `task ${task?.key ?? 'unknown'} ${finalAcceptance}${economicGate ? ` (risk ${economicGate.classification.class}, econ-verdict ${economicGate.verdict.verdict})` : ''}`.trim()
  };
  if (evidence?.costUsd != null) raw.cost = { usd: evidence.costUsd };
  if (Number.isFinite(startedAt)) raw.latencyMs = Math.max(0, now - startedAt);
  return raw;
}

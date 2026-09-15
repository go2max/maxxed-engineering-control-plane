function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

/**
 * Specialized review lenses for distinct economic surfaces. Each lens is a narrow, composable
 * check that emits a structured verdict rather than a single monolithic cost score, mirroring
 * the verifier's review-lens pattern for functional/security concerns.
 */

export function databaseCostLens({ dbReadsDelta = 0, dbWritesDelta = 0, dbScansDelta = 0, rowsReadVsReturnedRatio = 1 } = {}) {
  const findings = [];
  if (dbScansDelta > 0) findings.push('introduces-new-table-scan');
  if (rowsReadVsReturnedRatio > 50) findings.push('high-read-amplification');
  const escalate = dbScansDelta > 0 || rowsReadVsReturnedRatio > 50 || (dbWritesDelta + dbReadsDelta) > 10_000;
  return { lens: 'database', escalate, findings, dbReadsDelta, dbWritesDelta, dbScansDelta, rowsReadVsReturnedRatio };
}

export function aiSpendLens({ modelTokenSpendDeltaUsd = 0, callsPerRequest = 1, modelTier = 'standard' } = {}) {
  const findings = [];
  if (callsPerRequest > 3) findings.push('multiple-model-calls-per-request');
  if (modelTier === 'premium' && modelTokenSpendDeltaUsd > 5) findings.push('premium-model-material-spend');
  const escalate = Number(modelTokenSpendDeltaUsd) > 10 || callsPerRequest > 3;
  return { lens: 'ai-spend', escalate, findings, modelTokenSpendDeltaUsd, callsPerRequest, modelTier };
}

export function scheduledWorkLens({ frequencyPerMonthDelta = 0, jobDurationMsDelta = 0 } = {}) {
  const findings = [];
  if (frequencyPerMonthDelta > 0) findings.push('frequency-increase');
  if (jobDurationMsDelta > 0) findings.push('per-run-duration-increase');
  const escalate = frequencyPerMonthDelta > 1000 || (frequencyPerMonthDelta > 0 && jobDurationMsDelta > 0);
  return { lens: 'scheduled-work', escalate, findings, frequencyPerMonthDelta, jobDurationMsDelta };
}

export function thirdPartyApiLens({ callsPerMonthDelta = 0, costPerCallUsd = 0, rateLimitHeadroomRatio = 1 } = {}) {
  const projectedMonthlyDelta = Math.max(0, Number(callsPerMonthDelta)) * Math.max(0, Number(costPerCallUsd));
  const findings = [];
  if (rateLimitHeadroomRatio < 1.2) findings.push('rate-limit-headroom-thin');
  if (projectedMonthlyDelta > 25) findings.push('material-third-party-spend');
  const escalate = findings.length > 0;
  return { lens: 'third-party-api', escalate, findings, projectedMonthlyDelta, rateLimitHeadroomRatio };
}

export function storageEgressLens({ storageGrowthBytesPerMonth = 0, egressBytesPerMonth = 0 } = {}) {
  const gbGrowth = Number(storageGrowthBytesPerMonth) / (1024 ** 3);
  const gbEgress = Number(egressBytesPerMonth) / (1024 ** 3);
  const findings = [];
  if (gbGrowth > 50) findings.push('material-storage-growth');
  if (gbEgress > 50) findings.push('material-egress-growth');
  const escalate = findings.length > 0;
  return { lens: 'storage-egress', escalate, findings, storageGrowthGbPerMonth: gbGrowth, egressGbPerMonth: gbEgress };
}

export function fleetSizingLens({ workerFanOutDelta = 0, concurrentJobsDelta = 0 } = {}) {
  const findings = [];
  if (workerFanOutDelta > 0) findings.push('fan-out-increase');
  if (concurrentJobsDelta > 0) findings.push('concurrency-increase');
  const escalate = workerFanOutDelta > 4 || concurrentJobsDelta > 4;
  return { lens: 'fleet-sizing', escalate, findings, workerFanOutDelta, concurrentJobsDelta };
}

export function runAllLenses(inputs = {}) {
  const lenses = [
    databaseCostLens(inputs.database ?? {}),
    aiSpendLens(inputs.aiSpend ?? {}),
    scheduledWorkLens(inputs.scheduledWork ?? {}),
    thirdPartyApiLens(inputs.thirdPartyApi ?? {}),
    storageEgressLens(inputs.storageEgress ?? {}),
    fleetSizingLens(inputs.fleetSizing ?? {})
  ];
  return { lenses, escalate: lenses.some((lens) => lens.escalate) };
}

/** cost-per-accepted-capability: first-class economic efficiency metric. */
export function costPerAcceptedCapability({ totalMonthlyDeltaUsd = 0, acceptedCapabilitiesCount = 0 } = {}) {
  if (!acceptedCapabilitiesCount) return { costPerAcceptedCapabilityUsd: null, reason: 'no-accepted-capabilities' };
  return { costPerAcceptedCapabilityUsd: clamp(Number(totalMonthlyDeltaUsd) / Number(acceptedCapabilitiesCount), -Infinity, Infinity) };
}

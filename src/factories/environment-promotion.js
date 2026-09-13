export function buildPromotionRecord({ productKey, repository, environment, commitSha, specDigest, deploymentId, url, acceptanceBundleId, previousDeployment = null, rollout = null } = {}) {
  if (!productKey || !repository || !environment || !commitSha || !deploymentId || !url) throw new Error('productKey, repository, environment, commitSha, deploymentId and url are required');
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('commitSha must be a full 40-character SHA');
  if (specDigest && !/^[a-f0-9]{64}$/i.test(specDigest)) throw new Error('specDigest must be SHA-256');
  return {
    version: 2,
    productKey,
    repository,
    environment,
    commitSha,
    specDigest: specDigest ?? null,
    deploymentId,
    url,
    acceptanceBundleId: acceptanceBundleId ?? null,
    previousDeployment: previousDeployment ? structuredClone(previousDeployment) : null,
    rollout: rollout ? structuredClone(rollout) : { mode: 'all-at-once', stage: 'full', trafficPct: 100 },
    status: 'PROMOTED'
  };
}

export function verifyPromotionLineage({ promotion, acceptedCommitSha, acceptedSpecDigest = null } = {}) {
  if (!promotion) return { ok: false, reason: 'promotion record missing' };
  if (promotion.commitSha !== acceptedCommitSha) return { ok: false, reason: 'deployed commit differs from accepted commit' };
  if (acceptedSpecDigest && promotion.specDigest !== acceptedSpecDigest) return { ok: false, reason: 'deployed specification differs from accepted specification' };
  return { ok: true, reason: 'promotion lineage matches accepted artifact' };
}

export function buildCanaryPlan({ supported, stages = [5, 25, 50, 100], minHealthyMinutes = 5, maxErrorRate = 0.01, maxLatencyRegressionPct = 20 } = {}) {
  if (!supported) return { supported: false, mode: 'all-at-once', reason: 'deployment adapter does not support traffic splitting', stages: [100] };
  const normalized = [...new Set(stages.map(Number).filter((value) => value > 0 && value <= 100))].sort((a, b) => a - b);
  if (!normalized.includes(100)) normalized.push(100);
  return { supported: true, mode: 'progressive', stages: normalized, minHealthyMinutes: Math.max(1, Number(minHealthyMinutes)), thresholds: { maxErrorRate: Number(maxErrorRate), maxLatencyRegressionPct: Number(maxLatencyRegressionPct) } };
}

export function evaluateCanaryStage({ plan, stageIndex = 0, metrics = {} } = {}) {
  if (!plan?.stages?.length) throw new Error('canary plan is required');
  const trafficPct = plan.stages[stageIndex]; if (trafficPct == null) throw new Error('invalid canary stage');
  const failures = [];
  if (metrics.healthOk !== true) failures.push('health');
  if (Number(metrics.healthyMinutes ?? 0) < Number(plan.minHealthyMinutes ?? 0) && trafficPct < 100) failures.push('observation-window');
  if (Number(metrics.errorRate ?? 0) > Number(plan.thresholds?.maxErrorRate ?? 1)) failures.push('error-rate');
  if (Number(metrics.latencyRegressionPct ?? 0) > Number(plan.thresholds?.maxLatencyRegressionPct ?? Infinity)) failures.push('latency-regression');
  return { stageIndex, trafficPct, accepted: failures.length === 0, failures, nextTrafficPct: failures.length ? trafficPct : plan.stages[stageIndex + 1] ?? null, rollbackRequired: failures.some((failure) => failure !== 'observation-window') };
}

export function buildRollbackPlan(promotion, { reason = 'production verification failure' } = {}) {
  if (!promotion?.previousDeployment?.commitSha || !promotion?.previousDeployment?.deploymentId) {
    return { automatic: false, reason: 'no known-good previous deployment', actions: ['freeze-promotion', 'preserve-evidence', 'operator-recovery'] };
  }
  return {
    automatic: true,
    reason,
    target: structuredClone(promotion.previousDeployment),
    actions: ['freeze-current-release', 'restore-known-good-deployment', 'verify-exact-rollback-sha', 'run-production-smoke', 'record-rollback-evidence']
  };
}

export function productionAcceptanceRecord({ promotion, smoke = {}, browser = {}, api = {}, consoleErrors = 0, canary = null } = {}) {
  const failures = [];
  if (smoke.ok !== true) failures.push('health-smoke');
  if (browser.ok !== true) failures.push('browser-smoke');
  if (api.ok !== true) failures.push('critical-api');
  if (Number(consoleErrors) > 0) failures.push('console-errors');
  if (canary && canary.accepted !== true) failures.push(...(canary.failures ?? []).map((failure) => `canary:${failure}`));
  return {
    accepted: failures.length === 0,
    failures,
    commitSha: promotion?.commitSha ?? null,
    deploymentId: promotion?.deploymentId ?? null,
    evidence: { smoke, browser, api, consoleErrors: Number(consoleErrors), canary }
  };
}

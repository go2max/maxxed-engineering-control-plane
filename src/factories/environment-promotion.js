export function buildPromotionRecord({ productKey, repository, environment, commitSha, specDigest, deploymentId, url, acceptanceBundleId, previousDeployment = null } = {}) {
  if (!productKey || !repository || !environment || !commitSha || !deploymentId || !url) throw new Error('productKey, repository, environment, commitSha, deploymentId and url are required');
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('commitSha must be a full 40-character SHA');
  if (specDigest && !/^[a-f0-9]{64}$/i.test(specDigest)) throw new Error('specDigest must be SHA-256');
  return {
    version: 1,
    productKey,
    repository,
    environment,
    commitSha,
    specDigest: specDigest ?? null,
    deploymentId,
    url,
    acceptanceBundleId: acceptanceBundleId ?? null,
    previousDeployment: previousDeployment ? structuredClone(previousDeployment) : null,
    status: 'PROMOTED'
  };
}

export function verifyPromotionLineage({ promotion, acceptedCommitSha, acceptedSpecDigest = null } = {}) {
  if (!promotion) return { ok: false, reason: 'promotion record missing' };
  if (promotion.commitSha !== acceptedCommitSha) return { ok: false, reason: 'deployed commit differs from accepted commit' };
  if (acceptedSpecDigest && promotion.specDigest !== acceptedSpecDigest) return { ok: false, reason: 'deployed specification differs from accepted specification' };
  return { ok: true, reason: 'promotion lineage matches accepted artifact' };
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

export function productionAcceptanceRecord({ promotion, smoke = {}, browser = {}, api = {}, consoleErrors = 0 } = {}) {
  const failures = [];
  if (smoke.ok !== true) failures.push('health-smoke');
  if (browser.ok !== true) failures.push('browser-smoke');
  if (api.ok !== true) failures.push('critical-api');
  if (Number(consoleErrors) > 0) failures.push('console-errors');
  return {
    accepted: failures.length === 0,
    failures,
    commitSha: promotion?.commitSha ?? null,
    deploymentId: promotion?.deploymentId ?? null,
    evidence: { smoke, browser, api, consoleErrors: Number(consoleErrors) }
  };
}

import { createHash } from 'node:crypto';

export const BASELINE_CAPABILITIES = Object.freeze([
  'auth', 'tenant-isolation', 'billing-entitlements', 'admin', 'telemetry',
  'email', 'storage', 'security', 'ci', 'deployment', 'testing', 'docs',
  'legal', 'support'
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function specDigest(spec) {
  return createHash('sha256').update(JSON.stringify(stable(spec ?? {}))).digest('hex');
}

export function resolveProductDelta({ spec = {}, sharedCapabilities = BASELINE_CAPABILITIES } = {}) {
  const requested = [...new Set(spec.capabilities ?? [])].sort();
  const shared = new Set(sharedCapabilities);
  const reused = requested.filter((capability) => shared.has(capability));
  const productDelta = requested.filter((capability) => !shared.has(capability));
  return {
    specDigest: specDigest(spec),
    baselineVersion: spec.baselineVersion ?? 'saas-web-v1',
    reused,
    productDelta,
    reuseRate: requested.length ? reused.length / requested.length : 1
  };
}

export function buildBaselineContract({ productKey, repository, spec = {} } = {}) {
  if (!productKey || !repository) throw new Error('productKey and repository are required');
  const delta = resolveProductDelta({ spec });
  return {
    version: 1,
    productKey,
    repository,
    specification: { digest: delta.specDigest, baselineVersion: delta.baselineVersion },
    sharedCapabilities: delta.reused,
    productDelta: delta.productDelta,
    requiredFoundations: [...BASELINE_CAPABILITIES],
    invariantChecks: [
      'tenant-boundary', 'authz-boundary', 'billing-entitlement', 'audit-telemetry',
      'secret-handling', 'backup-recovery', 'accessibility', 'security', 'deployment-lineage'
    ]
  };
}

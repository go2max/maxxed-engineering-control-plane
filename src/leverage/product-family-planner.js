import { digest } from './solution-cas.js';

export class ProductFamilyPlanner {
  constructor() { this.baselines = new Map(); }

  registerBaseline({ family, version, features = {}, artifacts = {}, policy = {} } = {}) {
    if (!family || !version) throw new Error('family and version are required');
    const row = { family, version: String(version), features: structuredClone(features), artifacts: structuredClone(artifacts), policy: structuredClone(policy) };
    row.digest = digest(row); this.baselines.set(family, row); return structuredClone(row);
  }

  plan({ family, productFeatures = {}, productPolicy = {} } = {}) {
    const baseline = this.baselines.get(family); if (!baseline) throw new Error(`unknown product family: ${family}`);
    const featureDelta = {};
    const keys = new Set([...Object.keys(baseline.features), ...Object.keys(productFeatures)]);
    for (const key of keys) if (JSON.stringify(baseline.features[key]) !== JSON.stringify(productFeatures[key])) featureDelta[key] = { baseline: baseline.features[key] ?? null, desired: productFeatures[key] ?? null };
    const policyDelta = {};
    for (const key of new Set([...Object.keys(baseline.policy), ...Object.keys(productPolicy)])) if (JSON.stringify(baseline.policy[key]) !== JSON.stringify(productPolicy[key])) policyDelta[key] = { baseline: baseline.policy[key] ?? null, desired: productPolicy[key] ?? null };
    return { family, baselineVersion: baseline.version, baselineDigest: baseline.digest, featureDelta, policyDelta, deltaDigest: digest({ featureDelta, policyDelta }), reuseRatio: keys.size ? 1 - Object.keys(featureDelta).length / keys.size : 1 };
  }

  snapshot() { return { version: 1, baselines: [...this.baselines.entries()].map(([key, value]) => [key, structuredClone(value)]) }; }
  restore(snapshot) { this.baselines = new Map(structuredClone(snapshot?.baselines ?? [])); }
}

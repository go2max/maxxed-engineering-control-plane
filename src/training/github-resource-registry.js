const DEFAULT_ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
]);

export function validateResourceCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') errors.push('catalog must be an object');
  if (!Number.isInteger(catalog?.version) || catalog.version < 1) errors.push('version must be a positive integer');
  if (!Array.isArray(catalog?.sources) || catalog.sources.length === 0) errors.push('sources must be a non-empty array');

  const seen = new Set();
  for (const [index, source] of (catalog?.sources ?? []).entries()) {
    const prefix = `sources[${index}]`;
    if (!source.repo || !source.repo.includes('/')) errors.push(`${prefix}.repo must be owner/name`);
    if (seen.has(source.repo)) errors.push(`${prefix}.repo duplicates ${source.repo}`);
    seen.add(source.repo);
    if (!source.sector) errors.push(`${prefix}.sector is required`);
    if (!Array.isArray(source.capabilities) || source.capabilities.length === 0) errors.push(`${prefix}.capabilities must be non-empty`);
    if (!['adopt', 'adapt', 'reference', 'reject'].includes(source.action)) errors.push(`${prefix}.action is invalid`);
    if (typeof source.license_verified !== 'boolean') errors.push(`${prefix}.license_verified must be boolean`);
    if (!Number.isFinite(source.priority) || source.priority < 0 || source.priority > 100) errors.push(`${prefix}.priority must be 0..100`);

    if (source.action === 'adopt' || source.action === 'adapt') {
      if (!source.license_verified) errors.push(`${prefix} cannot ${source.action} without verified license`);
      if (!DEFAULT_ALLOWED_LICENSES.has(source.license)) errors.push(`${prefix} license ${source.license} is not on the permissive adoption allowlist`);
      if (source.archived) errors.push(`${prefix} cannot ${source.action} an archived repository`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function selectAdoptableSources(catalog, { sectors = null, minPriority = 0 } = {}) {
  const allowed = new Set(catalog.allowed_adoption_licenses ?? [...DEFAULT_ALLOWED_LICENSES]);
  const sectorSet = sectors ? new Set(sectors) : null;
  return (catalog.sources ?? [])
    .filter((source) => ['adopt', 'adapt'].includes(source.action))
    .filter((source) => source.license_verified && allowed.has(source.license))
    .filter((source) => !source.archived)
    .filter((source) => source.priority >= minPriority)
    .filter((source) => !sectorSet || sectorSet.has(source.sector))
    .sort((a, b) => b.priority - a.priority || a.repo.localeCompare(b.repo));
}

export function summarizeSectorCoverage(catalog) {
  const sectors = new Map();
  for (const source of catalog.sources ?? []) {
    const entry = sectors.get(source.sector) ?? { total: 0, adoptable: 0, references: 0, capabilities: new Set() };
    entry.total += 1;
    if (['adopt', 'adapt'].includes(source.action) && source.license_verified && DEFAULT_ALLOWED_LICENSES.has(source.license) && !source.archived) {
      entry.adoptable += 1;
    }
    if (source.action === 'reference') entry.references += 1;
    for (const capability of source.capabilities ?? []) entry.capabilities.add(capability);
    sectors.set(source.sector, entry);
  }

  return Object.fromEntries(
    [...sectors.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sector, entry]) => [sector, {
        total: entry.total,
        adoptable: entry.adoptable,
        references: entry.references,
        capabilities: [...entry.capabilities].sort(),
      }]),
  );
}

export function buildHarvestQueue(catalog, { minPriority = 80 } = {}) {
  return (catalog.sources ?? [])
    .filter((source) => source.action !== 'reject' && source.priority >= minPriority)
    .map((source) => ({
      repo: source.repo,
      sector: source.sector,
      priority: source.priority,
      disposition: source.action,
      gate: source.license_verified ? 'provenance-and-fit-review' : 'license-verification',
      capabilities: source.capabilities,
    }))
    .sort((a, b) => b.priority - a.priority || a.repo.localeCompare(b.repo));
}

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildHarvestQueue, summarizeSectorCoverage, validateResourceCatalog } from '../src/training/github-resource-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const catalogPath = path.join(root, 'training', 'sources', 'github-resource-catalog.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const result = validateResourceCatalog(catalog);

if (!result.valid) {
  console.error('GitHub resource catalog validation failed:');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const coverage = summarizeSectorCoverage(catalog);
  const queue = buildHarvestQueue(catalog, { minPriority: 80 });
  console.log(`GitHub resource catalog valid: ${catalog.sources.length} sources, ${Object.keys(coverage).length} sectors, ${queue.length} high-priority harvest candidates.`);
}

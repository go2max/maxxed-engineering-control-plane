import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildHarvestQueue, selectAdoptableSources, summarizeSectorCoverage, validateResourceCatalog } from '../src/training/github-resource-registry.js';

const catalog = JSON.parse(await fs.readFile(new URL('../training/sources/github-resource-catalog.json', import.meta.url), 'utf8'));

test('resource catalog is structurally valid and license-gated', () => {
  const result = validateResourceCatalog(catalog);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('adoptable sources are verified, permissive, live, and priority sorted', () => {
  const sources = selectAdoptableSources(catalog, { minPriority: 90 });
  assert.ok(sources.length >= 5);
  for (const source of sources) {
    assert.equal(source.license_verified, true);
    assert.equal(source.archived, false);
    assert.ok(catalog.allowed_adoption_licenses.includes(source.license));
    assert.ok(['adopt', 'adapt'].includes(source.action));
  }
  for (let i = 1; i < sources.length; i += 1) assert.ok(sources[i - 1].priority >= sources[i].priority);
});

test('unverified high-value repositories remain reference-only', () => {
  const llamaCpp = catalog.sources.find((source) => source.repo === 'ggerganov/llama.cpp');
  assert.equal(llamaCpp.action, 'reference');
  assert.equal(llamaCpp.license_verified, false);
  assert.equal(selectAdoptableSources(catalog).some((source) => source.repo === llamaCpp.repo), false);
});

test('coverage spans model, evaluation, agent, retrieval, security and scientific sectors', () => {
  const coverage = summarizeSectorCoverage(catalog);
  for (const sector of ['agent-orchestration', 'evaluation', 'rag-retrieval', 'security-reliability', 'mathematics-science', 'fine-tuning', 'local-inference']) {
    assert.ok(coverage[sector], `missing sector ${sector}`);
  }
});

test('harvest queue sends unknown licenses to verification before provenance review', () => {
  const queue = buildHarvestQueue(catalog, { minPriority: 95 });
  const transformers = queue.find((item) => item.repo === 'huggingface/transformers');
  const llamaIndex = queue.find((item) => item.repo === 'run-llama/llama_index');
  assert.equal(transformers.gate, 'license-verification');
  assert.equal(llamaIndex.gate, 'provenance-and-fit-review');
});

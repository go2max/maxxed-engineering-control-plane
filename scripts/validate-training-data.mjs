import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('training/manifest.json', root), 'utf8'));

async function readJsonl(path) {
  const text = await readFile(new URL(path, root), 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`); }
  });
}

const errors = [];
const required = ['id', 'task_class', 'source_category', 'instruction', 'input', 'output', 'provenance', 'tags'];
const canonicalDomains = new Set(manifest.domains || []);

// `datasets` is the current multi-dataset structure; fall back to the legacy single `splits`
// entry if a manifest hasn't been migrated to it yet.
const datasets = manifest.datasets && manifest.datasets.length
  ? manifest.datasets
  : [{ dataset_id: manifest.dataset_id, domain: null, train: manifest.splits.train, eval: manifest.splits.eval }];

function validateRow(row, datasetId, split, index) {
  const label = `${datasetId}/${split}[${index}]`;
  for (const key of required) if (!(key in row)) errors.push(`${label} missing ${key}`);
  if (!row.id || typeof row.id !== 'string') errors.push(`${label} invalid id`);
  if (!Array.isArray(row.tags)) errors.push(`${label} tags must be an array`);
  if (!row.provenance || typeof row.provenance !== 'object') errors.push(`${label} provenance must be an object`);
  if (row.domain && !canonicalDomains.has(row.domain)) {
    errors.push(`${label} unknown domain "${row.domain}" (must be one of: ${[...canonicalDomains].join(', ')})`);
  }
  const serialized = JSON.stringify(row).toLowerCase();
  for (const marker of ['authorization: bearer ', 'api_key=', 'password=', 'private key-----begin']) {
    if (serialized.includes(marker)) errors.push(`${label} possible secret/private material marker: ${marker}`);
  }
}

const allIds = [];
let totalTrain = 0;
let totalEval = 0;
const allCategories = new Set();

for (const dataset of datasets) {
  const train = await readJsonl(`training/${dataset.train}`);
  const evalRows = await readJsonl(`training/${dataset.eval}`);

  train.forEach((row, index) => validateRow(row, dataset.dataset_id, 'train', index));
  evalRows.forEach((row, index) => validateRow(row, dataset.dataset_id, 'eval', index));

  // Per-dataset domain purity: a dataset declares one domain, so no record in it may claim a
  // different domain (this is the "must stay separated, not contaminated into one corpus" rule).
  if (dataset.domain) {
    for (const row of [...train, ...evalRows]) {
      if (row.domain && row.domain !== dataset.domain) {
        errors.push(
          `${dataset.dataset_id}: record ${row.id} declares domain "${row.domain}" but dataset is domain "${dataset.domain}"`
        );
      }
    }
  }

  const trainIds = new Set(train.map((row) => row.id));
  for (const row of evalRows) if (trainIds.has(row.id)) errors.push(`${dataset.dataset_id}: eval id appears in train: ${row.id}`);

  const trainInputs = new Set(train.map((row) => JSON.stringify({ instruction: row.instruction, input: row.input })));
  for (const row of evalRows) {
    const fingerprint = JSON.stringify({ instruction: row.instruction, input: row.input });
    if (trainInputs.has(fingerprint)) errors.push(`${dataset.dataset_id}: eval instruction/input duplicates train: ${row.id}`);
  }

  allIds.push(...train.map((r) => r.id), ...evalRows.map((r) => r.id));
  for (const row of [...train, ...evalRows]) if (row.source_category) allCategories.add(row.source_category);
  totalTrain += train.length;
  totalEval += evalRows.length;
}

const duplicateIds = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (duplicateIds.length) errors.push(`duplicate ids across datasets: ${[...new Set(duplicateIds)].join(', ')}`);

const expectedSourceCategories = new Set(['compute-fabric','control-plane-core','portfolio-scheduler','verifier-repair','local-model-router','admin-integration','saas-web-factory']);
for (const category of expectedSourceCategories) {
  if (!allCategories.has(category)) errors.push(`missing source category: ${category}`);
}

if (errors.length) {
  console.error('Training data validation failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

console.log(
  `Training data valid: ${totalTrain} train + ${totalEval} eval records across ${datasets.length} dataset(s); ` +
    `${allCategories.size} source categories; no ID/input contamination detected.`
);

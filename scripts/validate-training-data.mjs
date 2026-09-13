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

const train = await readJsonl(`training/${manifest.splits.train}`);
const evalRows = await readJsonl(`training/${manifest.splits.eval}`);
const errors = [];
const required = ['id', 'task_class', 'source_category', 'instruction', 'input', 'output', 'provenance', 'tags'];

function validateRow(row, split, index) {
  for (const key of required) if (!(key in row)) errors.push(`${split}[${index}] missing ${key}`);
  if (!row.id || typeof row.id !== 'string') errors.push(`${split}[${index}] invalid id`);
  if (!Array.isArray(row.tags)) errors.push(`${split}[${index}] tags must be an array`);
  if (!row.provenance || typeof row.provenance !== 'object') errors.push(`${split}[${index}] provenance must be an object`);
  const serialized = JSON.stringify(row).toLowerCase();
  for (const marker of ['authorization: bearer ', 'api_key=', 'password=', 'private key-----begin']) {
    if (serialized.includes(marker)) errors.push(`${split}[${index}] possible secret/private material marker: ${marker}`);
  }
}

train.forEach((row, index) => validateRow(row, 'train', index));
evalRows.forEach((row, index) => validateRow(row, 'eval', index));

const allIds = [...train, ...evalRows].map((row) => row.id);
const duplicateIds = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (duplicateIds.length) errors.push(`duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);

const trainIds = new Set(train.map((row) => row.id));
for (const row of evalRows) if (trainIds.has(row.id)) errors.push(`eval id appears in train: ${row.id}`);

const trainInputs = new Set(train.map((row) => JSON.stringify({ instruction: row.instruction, input: row.input })));
for (const row of evalRows) {
  const fingerprint = JSON.stringify({ instruction: row.instruction, input: row.input });
  if (trainInputs.has(fingerprint)) errors.push(`eval instruction/input duplicates train: ${row.id}`);
}

const categories = new Set([...train, ...evalRows].map((row) => row.source_category));
const expected = new Set(['compute-fabric','control-plane-core','portfolio-scheduler','verifier-repair','local-model-router','admin-integration','saas-web-factory']);
for (const category of expected) if (!categories.has(category)) errors.push(`missing source category: ${category}`);

if (errors.length) {
  console.error('Training data validation failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Training data valid: ${train.length} train + ${evalRows.length} eval records; ${categories.size} categories; no ID/input contamination detected.`);

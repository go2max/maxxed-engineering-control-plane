import { readFile } from 'node:fs/promises';

const tracker = JSON.parse(await readFile(new URL('../planning/completion-tracker.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../validation/acceptance-manifest.json', import.meta.url), 'utf8'));

const errors = [];
const expected = new Set(Object.keys(manifest.categories));
const rows = new Map((tracker.categories ?? []).map((row) => [row.id, row]));

for (const id of expected) {
  const row = rows.get(id);
  if (!row) { errors.push(`missing completion row: ${id}`); continue; }
  if (row.completion_pct !== 100) errors.push(`${id}: implementation must be 100 before validation`);
  if (!Number.isInteger(row.validation_passes) || row.validation_passes < 0 || row.validation_passes > manifest.policy.required_passes) errors.push(`${id}: invalid validation_passes`);
  const shouldClear = row.completion_pct === 100 && row.validation_passes >= manifest.policy.required_passes;
  if (Boolean(row.clear_eligible) !== shouldClear) errors.push(`${id}: clear_eligible does not match two-pass retirement rule`);
  if (row.validation_passes < manifest.policy.required_passes && row.clear_eligible) errors.push(`${id}: row cannot clear before two validation passes`);
}

for (const row of tracker.categories ?? []) if (!expected.has(row.id)) errors.push(`unexpected completion row without acceptance contract: ${row.id}`);

if (tracker.retirement_policy?.completion_required_pct !== 100) errors.push('retirement policy completion threshold must remain 100');
if (tracker.retirement_policy?.validation_passes_required !== manifest.policy.required_passes) errors.push('retirement policy validation pass count differs from acceptance manifest');

if (errors.length) {
  console.error('Completion validation failed:\n' + errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Completion tracker valid: ${rows.size} categories are implementation-complete; no category clears before ${manifest.policy.required_passes} genuine validation passes.`);

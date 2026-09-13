import { readFile } from 'node:fs/promises';

const tracker = JSON.parse(await readFile(new URL('../planning/completion-tracker.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../validation/acceptance-manifest.json', import.meta.url), 'utf8'));

const errors = [];
const expected = new Set(Object.keys(manifest.categories));
const active = tracker.categories ?? [];
const retired = tracker.retired_categories ?? [];
const activeRows = new Map(active.map((row) => [row.id, row]));
const retiredRows = new Map(retired.map((row) => [row.id, row]));

for (const id of expected) {
  const activeRow = activeRows.get(id);
  const retiredRow = retiredRows.get(id);
  if (activeRow && retiredRow) { errors.push(`${id}: category cannot be active and retired`); continue; }
  const row = activeRow ?? retiredRow;
  if (!row) { errors.push(`missing completion or retired row: ${id}`); continue; }
  if (row.completion_pct !== 100) errors.push(`${id}: implementation must be 100 before validation`);
  if (!Number.isInteger(row.validation_passes) || row.validation_passes < 0 || row.validation_passes > manifest.policy.required_passes) errors.push(`${id}: invalid validation_passes`);

  const validated = row.completion_pct === 100 && row.validation_passes >= manifest.policy.required_passes;
  if (activeRow) {
    if (validated) errors.push(`${id}: validated category must be retired from active rows`);
    if (row.clear_eligible) errors.push(`${id}: active category cannot be clear_eligible`);
  } else {
    if (!validated) errors.push(`${id}: retired category lacks required validation passes`);
    if (row.clear_eligible !== true) errors.push(`${id}: retired category must be clear_eligible`);
    if (row.status !== 'retired') errors.push(`${id}: retired category status must be retired`);
  }
}

for (const row of [...active, ...retired]) if (!expected.has(row.id)) errors.push(`unexpected completion row without acceptance contract: ${row.id}`);

if (tracker.retirement_policy?.completion_required_pct !== 100) errors.push('retirement policy completion threshold must remain 100');
if (tracker.retirement_policy?.validation_passes_required !== manifest.policy.required_passes) errors.push('retirement policy validation pass count differs from acceptance manifest');

if (errors.length) {
  console.error('Completion validation failed:\n' + errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Completion tracker valid: ${active.length} active categories, ${retired.length} retired after ${manifest.policy.required_passes}/2 qualifying validation passes.`);

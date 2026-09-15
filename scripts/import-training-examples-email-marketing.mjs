#!/usr/bin/env node
// Import path: llm_control.training_examples (email-marketing's Neon/Postgres DB) -> this repo's
// domain-tagged training/{train,eval} JSONL corpus.
//
// This is a READ-ONLY import. It never writes to the source database. The control plane owns
// its own training data store from this point forward; email-marketing's training_examples table
// is treated purely as one importable *source*, not as the architectural home of training data.
//
// Usage:
//   node scripts/import-training-examples-email-marketing.mjs [options]
//
// Options:
//   --env-file <path>     Path to a dotenv-style file to load EMAIL_MARKETING_DATABASE_URL from
//                          (or DATABASE_URL, as a fallback var name), e.g. email-marketing's own
//                          .env.local. The file is read only by this process; its contents are
//                          never logged or written anywhere.
//   --limit <n>            Max rows to import (default: all). Useful for a bounded test import.
//   --dataset-version <v>  Version tag stamped into provenance and the output filenames
//                          (default: "v1").
//   --domain <name>        Target domain (default: "outreach-support" — see the 7-domain list in
//                          training/manifest.json). Existing legacy training_examples rows are, by
//                          construction, outreach copy/support examples, so this should normally be
//                          left at the default.
//   --dry-run               Connect, read, map, and validate, but do not write any output files.
//
// Env vars (alternative to --env-file):
//   EMAIL_MARKETING_DATABASE_URL   preferred explicit name for the source connection string
//   DATABASE_URL                   fallback if the explicit name isn't set
//
// Output:
//   training/train/<domain>-email-marketing-<dataset-version>.jsonl
//   training/eval/<domain>-email-marketing-<dataset-version>.jsonl
//   training/import-runs/<domain>-email-marketing-<dataset-version>.json  (run manifest/provenance summary)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const CANONICAL_DOMAINS = [
  'coding',
  'repository-understanding',
  'infrastructure-diagnosis',
  'business-reasoning',
  'outreach-support',
  'orchestration-agent-planning',
  'security-reliability',
];

function parseArgs(argv) {
  const args = {
    envFile: null,
    limit: null,
    datasetVersion: 'v1',
    domain: 'outreach-support',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env-file') args.envFile = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--dataset-version') args.datasetVersion = argv[++i];
    else if (a === '--domain') args.domain = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unrecognized argument: ${a}`);
  }
  if (!CANONICAL_DOMAINS.includes(args.domain)) {
    throw new Error(`--domain must be one of: ${CANONICAL_DOMAINS.join(', ')}`);
  }
  return args;
}

/** Minimal dotenv-style loader. Only sets vars we need; never echoes file contents. */
async function loadEnvFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  const wanted = new Set(['EMAIL_MARKETING_DATABASE_URL', 'DATABASE_URL']);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!wanted.has(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveConnectionString() {
  const cs = process.env.EMAIL_MARKETING_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error(
      'No source connection string found. Set EMAIL_MARKETING_DATABASE_URL (preferred) or ' +
        'DATABASE_URL, or pass --env-file pointing at a dotenv file that defines one of those.'
    );
  }
  return cs;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Deterministic 70/15/15 bucket, independent of any single field's cardinality — mirrors the
 *  evidence-based approach in email-marketing's lib/training-system/evidence.ts (assignDatasetSplit),
 *  but reimplemented here (not imported) since it is not yet ported into this repo. */
function assignSplit(key) {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  const bucket = digest.readUInt32BE(0) % 100;
  if (bucket < 85) return 'train'; // 85/15 train/eval (this import has no separate held-out "test")
  return 'eval';
}

function mapRowToRecord(row, { domain, datasetVersion, importedAt }) {
  const id = `outreach-support-em-${row.id}`;
  const instruction =
    'Given the prior conversation context, produce the outreach message that was sent.';
  const record = {
    id,
    task_class: row.label === 'corrected' ? 'copy-correction' : 'copy-generation',
    source_category: 'outreach-support',
    domain,
    instruction,
    input: {
      source_conversation_id: row.source_conversation_id,
      source_message_id: row.source_message_id ?? null,
      intent: row.intent ?? null,
      text: row.input,
    },
    output: row.ideal_response,
    provenance: {
      source_system: 'email-marketing',
      source_table: 'llm_control.training_examples',
      source_record_id: row.id,
      source_created_at: row.created_at,
      source_updated_at: row.updated_at,
      original_label: row.label,
      imported_at: importedAt,
      import_dataset_version: datasetVersion,
      import_script: 'scripts/import-training-examples-email-marketing.mjs',
      notes: row.notes ?? null,
    },
    tags: ['imported', 'email-marketing', 'legacy-transport-accepted-label'],
  };
  const splitKey = row.source_conversation_id || String(row.id);
  return { record, split: assignSplit(splitKey) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) await loadEnvFile(args.envFile);
  const connectionString = resolveConnectionString();

  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });

  const importedAt = new Date().toISOString();
  const trainRows = [];
  const evalRows = [];
  const seenIds = new Set();
  let totalRead = 0;
  let skippedDuplicate = 0;
  let skippedExcluded = 0;

  try {
    // Explicit read-only transaction: this import must never mutate the source DB.
    await pool.query('BEGIN TRANSACTION READ ONLY');
    const limitClause = args.limit ? `LIMIT ${Number(args.limit)}` : '';
    const { rows } = await pool.query(
      `SELECT id, source_conversation_id, source_message_id, input, ideal_response,
              intent, label, excluded, notes, created_at, updated_at
         FROM llm_control.training_examples
        WHERE excluded IS NOT TRUE
          AND label IS NOT NULL
        ORDER BY created_at ASC
        ${limitClause}`
    );
    await pool.query('COMMIT');

    for (const row of rows) {
      totalRead++;
      const { record, split } = mapRowToRecord(row, {
        domain: args.domain,
        datasetVersion: args.datasetVersion,
        importedAt,
      });
      if (seenIds.has(record.id)) {
        skippedDuplicate++;
        continue;
      }
      seenIds.add(record.id);
      if (split === 'train') trainRows.push(record);
      else evalRows.push(record);
    }
  } finally {
    await pool.end();
  }

  const domainSlug = args.domain;
  const trainPath = path.join(repoRoot, 'training', 'train', `${domainSlug}-email-marketing-${args.datasetVersion}.jsonl`);
  const evalPath = path.join(repoRoot, 'training', 'eval', `${domainSlug}-email-marketing-${args.datasetVersion}.jsonl`);
  const runManifestPath = path.join(
    repoRoot,
    'training',
    'import-runs',
    `${domainSlug}-email-marketing-${args.datasetVersion}.json`
  );

  const trainText = trainRows.map((r) => JSON.stringify(r)).join('\n') + (trainRows.length ? '\n' : '');
  const evalText = evalRows.map((r) => JSON.stringify(r)).join('\n') + (evalRows.length ? '\n' : '');

  const runManifest = {
    dataset_version: args.datasetVersion,
    domain: args.domain,
    source_system: 'email-marketing',
    source_table: 'llm_control.training_examples',
    imported_at: importedAt,
    counts: {
      source_rows_read: totalRead,
      imported_train: trainRows.length,
      imported_eval: evalRows.length,
      skipped_duplicate: skippedDuplicate,
      skipped_excluded_or_unlabeled: skippedExcluded,
    },
    content_hash: {
      train_sha256: sha256(trainText),
      eval_sha256: sha256(evalText),
    },
    caveats: [
      'Source labels (good/bad/corrected) are transport-accepted only per email-marketing\'s own ' +
        'CANONICAL_TRAINING_VERIFICATION_REPORT.md; they are NOT evidence of output quality and must ' +
        'not be treated as a promotion-eligible gold/silver/bronze quality tier without independent evaluation.',
      'This import is a raw provenance-tagged copy for corpus-building purposes; it does not run ' +
        'the eligibility/trust gates described in email-marketing\'s training-system architecture.',
    ],
  };

  if (args.dryRun) {
    console.log('[dry-run] would write:');
    console.log(`  ${trainPath} (${trainRows.length} records)`);
    console.log(`  ${evalPath} (${evalRows.length} records)`);
    console.log(`  ${runManifestPath}`);
    console.log(JSON.stringify(runManifest, null, 2));
    return;
  }

  await mkdir(path.dirname(trainPath), { recursive: true });
  await mkdir(path.dirname(evalPath), { recursive: true });
  await mkdir(path.dirname(runManifestPath), { recursive: true });
  await writeFile(trainPath, trainText, 'utf8');
  await writeFile(evalPath, evalText, 'utf8');
  await writeFile(runManifestPath, JSON.stringify(runManifest, null, 2) + '\n', 'utf8');

  console.log(
    `Imported ${trainRows.length} train + ${evalRows.length} eval records from ` +
      `${totalRead} source rows (domain=${args.domain}, dataset_version=${args.datasetVersion}).`
  );
  console.log(`Wrote:\n  ${trainPath}\n  ${evalPath}\n  ${runManifestPath}`);
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});

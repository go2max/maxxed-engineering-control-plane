#!/usr/bin/env node
// Runs the promotion gate (src/training/promotion-gate.js) against two already-scored models and
// writes a decision record. This is the composable "next step" after scripts/evaluate-model.mjs
// (not yet built -- see docs/training/EVALUATION_PROMOTION_PORT_DESIGN.md) produces per-domain
// scores; this script does not itself call a model or a benchmark.
//
// Usage:
//   node scripts/promote-model.mjs \
//     --domain coding \
//     --incumbent-scores training/runs/<incumbent>/scores.json \
//     --candidate-scores training/runs/<candidate>/scores.json \
//     [--policy training/MAXXED_PROMOTION_POLICY_V1.json] \
//     [--out training/runs/<run-id>-decision.json]
//
// Score files are JSON objects keyed by domain -> DomainScores (see
// src/training/promotion-gate.js jsdoc / src/training/score-benchmark.js's aggregateDomainScores
// output). Exit code is 0 for PROMOTE, 1 for REJECT, 2 for a usage/input error -- wire this into
// CI the same way `npm run validate:training` is wired in today (non-zero fails the job).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluatePromotionGate, DEFAULT_PROMOTION_POLICY } from '../src/training/promotion-gate.js';

const root = new URL('../', import.meta.url);

function resolvePath(path) {
  return isAbsolute(path) ? pathToFileURL(path) : new URL(path, root);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[key] = value;
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolvePath(path), 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { domain, 'incumbent-scores': incumbentPath, 'candidate-scores': candidatePath } = args;

  if (!domain || !incumbentPath || !candidatePath) {
    console.error('usage: node scripts/promote-model.mjs --domain <domain> --incumbent-scores <path> --candidate-scores <path> [--policy <path>] [--out <path>]');
    process.exitCode = 2;
    return;
  }

  const incumbentScores = await readJson(incumbentPath);
  const candidateScores = await readJson(candidatePath);

  let policy = DEFAULT_PROMOTION_POLICY;
  if (args.policy) {
    const loaded = await readJson(args.policy);
    // strip documentation-only fields (status/notes) before use
    const { status, notes, ...gatePolicy } = loaded;
    policy = gatePolicy;
  }

  const result = evaluatePromotionGate({ targetDomain: domain, incumbentScores, candidateScores, policy });

  const decision = {
    ranAt: new Date().toISOString(),
    domain,
    incumbentScoresFile: incumbentPath,
    candidateScoresFile: candidatePath,
    policyFile: args.policy ?? '(built-in DEFAULT_PROMOTION_POLICY)',
    ...result,
  };

  const outPath = args.out ?? `training/runs/${Date.now()}-${domain}-decision.json`;
  const outUrl = resolvePath(outPath);
  await mkdir(new URL('.', outUrl), { recursive: true });
  await writeFile(outUrl, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');

  console.log(`verdict: ${result.verdict} (domain=${domain})`);
  for (const reason of result.reasons) console.log(`  - ${reason}`);
  console.log(`decision written to ${outPath}`);

  process.exitCode = result.verdict === 'PROMOTE' ? 0 : 1;
}

await main();

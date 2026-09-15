#!/usr/bin/env node
// Reuse-vs-newly-authored metrics (issue #50 acceptance criterion: "generated metrics can later
// track code reused vs newly authored and estimated engineering time avoided").
//
// Scans a set of PR body texts for `reuse:` declarations (see scripts/check-reuse-gate.mjs for
// the parser) and an optional "estimated avoided engineering time" line, and reports counts by
// category plus any recorded avoided-hours estimates.
//
// Usage:
//   node scripts/reuse-metrics.mjs <file-or-directory> [...more files/directories]
//
// Each input is either:
//   - a single text file containing one PR body, or
//   - a .jsonl file where each line is {"number": <pr number>, "body": "<pr body text>"}, or
//   - a directory, scanned non-recursively for *.md / *.txt / *.jsonl files.
//
// This is a local/offline reporting tool -- it does not call the GitHub API itself, so it has no
// network dependency and can run in CI or a sandbox. Feed it PR bodies fetched however the caller
// prefers (e.g. `gh pr list --json number,body` piped to a .jsonl file).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parseReuseDeclaration } from './check-reuse-gate.mjs';

const AVOIDED_HOURS_PATTERN = /~?(\d+(?:\.\d+)?)\s*(engineer-day|eng-day|day|hour|hr)s?\b/i;
const HOURS_PER_DAY = 8;

function toHours(amount, unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('day') || u === 'eng-day' || u === 'engineer-day') return amount * HOURS_PER_DAY;
  return amount;
}

function extractAvoidedHours(text) {
  const match = text.match(AVOIDED_HOURS_PATTERN);
  if (!match) return null;
  return toHours(parseFloat(match[1]), match[2]);
}

function collectPrBodies(inputs) {
  const bodies = [];
  for (const input of inputs) {
    const stat = statSync(input);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(input)) {
        const ext = extname(entry);
        if (['.md', '.txt', '.jsonl'].includes(ext)) bodies.push(...collectPrBodies([join(input, entry)]));
      }
      continue;
    }
    if (extname(input) === '.jsonl') {
      const lines = readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const row = JSON.parse(line);
        bodies.push({ id: row.number != null ? `#${row.number}` : input, body: row.body ?? '' });
      }
    } else {
      bodies.push({ id: input, body: readFileSync(input, 'utf8') });
    }
  }
  return bodies;
}

export function computeReuseMetrics(bodies) {
  const byCategory = { internal: 0, external: 0, 'synthesized-top-25': 0, none: 0, unlabeled: 0 };
  let totalAvoidedHours = 0;
  const details = [];

  for (const { id, body } of bodies) {
    const parsed = parseReuseDeclaration(body);
    const category = parsed.valid ? parsed.category : 'unlabeled';
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const avoidedHours = extractAvoidedHours(body);
    if (avoidedHours) totalAvoidedHours += avoidedHours;
    details.push({ id, category, avoidedHours });
  }

  const reusedCount = byCategory.internal + byCategory.external + byCategory['synthesized-top-25'];
  const totalCount = bodies.length;

  return {
    totalCount,
    byCategory,
    reusedCount,
    newlyAuthoredCount: byCategory.none,
    unlabeledCount: byCategory.unlabeled,
    reuseRate: totalCount > 0 ? reusedCount / (reusedCount + byCategory.none) || 0 : 0,
    totalAvoidedHours,
    details,
  };
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error('usage: node scripts/reuse-metrics.mjs <file-or-directory> [...more]');
    process.exit(2);
  }
  const bodies = collectPrBodies(inputs);
  const metrics = computeReuseMetrics(bodies);

  console.log(`Reuse metrics over ${metrics.totalCount} PR(s):`);
  for (const [category, count] of Object.entries(metrics.byCategory)) {
    console.log(`  ${category}: ${count}`);
  }
  console.log(`  reused (internal+external+synthesized-top-25): ${metrics.reusedCount}`);
  console.log(`  newly authored (reuse: none): ${metrics.newlyAuthoredCount}`);
  console.log(`  reuse rate (of labeled PRs): ${(metrics.reuseRate * 100).toFixed(1)}%`);
  console.log(`  total estimated avoided engineering hours: ${metrics.totalAvoidedHours}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

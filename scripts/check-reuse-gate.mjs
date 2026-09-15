#!/usr/bin/env node
// Reuse-first engineering gate enforcement (issue #50 / ADR 0006 / docs/REUSE_FIRST_CHECKLIST.md).
//
// Validates that a PR body (or any text) contains exactly one well-formed `reuse:` declaration
// from .github/pull_request_template.md, and that category-specific required fields are present.
//
// Usage:
//   node scripts/check-reuse-gate.mjs <path-to-pr-body-file>
//   node scripts/check-reuse-gate.mjs -            # read from stdin
//   PR_BODY="..." node scripts/check-reuse-gate.mjs # read from env var
//
// Exits 0 and prints the parsed declaration on success; exits 1 with a diagnostic otherwise.
// Intended for local use and CI. Wired into .github/workflows/ci.yml as an
// `if: github.event_name == 'pull_request'` step that reads `github.event.pull_request.body`
// and pipes it in via stdin -- there is no PR body to validate on a plain `push` event, so the
// step is skipped there. See docs/REUSE_FIRST_CHECKLIST.md for details.

import { readFileSync } from 'node:fs';

const VALID_CATEGORIES = ['internal', 'external', 'synthesized-top-25', 'none'];

const REQUIRED_FIELDS_BY_CATEGORY = {
  internal: ['reused-component'],
  external: ['source-repo', 'source-ref', 'license', 'adapted-as'],
  'synthesized-top-25': ['candidate-pool', 'extracted-mechanisms'],
  none: ['reason'],
};

export function parseReuseDeclaration(text) {
  if (typeof text !== 'string') throw new Error('parseReuseDeclaration requires a string');

  const reuseLines = [...text.matchAll(/^\s*reuse:\s*(\S+)\s*$/gm)];
  if (reuseLines.length === 0) {
    return { valid: false, errors: ['no "reuse:" line found (required by docs/REUSE_FIRST_CHECKLIST.md)'] };
  }
  if (reuseLines.length > 1) {
    return { valid: false, errors: [`expected exactly one "reuse:" line, found ${reuseLines.length}`] };
  }

  const category = reuseLines[0][1];
  if (!VALID_CATEGORIES.includes(category)) {
    return { valid: false, errors: [`"reuse: ${category}" is not a recognized category (expected one of: ${VALID_CATEGORIES.join(', ')})`] };
  }

  const fields = {};
  for (const match of text.matchAll(/^\s*([a-z][a-z0-9-]*):\s*(.+?)\s*$/gm)) {
    const [, key, value] = match;
    if (key === 'reuse') continue;
    fields[key] = value;
  }

  const requiredFields = REQUIRED_FIELDS_BY_CATEGORY[category];
  const errors = [];
  for (const field of requiredFields) {
    const value = fields[field];
    if (!value || /^<.*>$/.test(value.trim())) {
      errors.push(`"reuse: ${category}" requires a filled-in "${field}:" field`);
    }
  }

  return { valid: errors.length === 0, category, fields, errors };
}

async function main() {
  const arg = process.argv[2];
  let text;
  if (process.env.PR_BODY) {
    text = process.env.PR_BODY;
  } else if (arg === '-') {
    text = readFileSync(0, 'utf8');
  } else if (arg) {
    text = readFileSync(arg, 'utf8');
  } else {
    console.error('usage: node scripts/check-reuse-gate.mjs <path|-> (or set PR_BODY env var)');
    process.exit(2);
  }

  const result = parseReuseDeclaration(text);
  if (!result.valid) {
    console.error('Reuse-first gate check failed:\n' + result.errors.map((e) => `- ${e}`).join('\n'));
    process.exit(1);
  }

  console.log(`Reuse-first gate ok: reuse: ${result.category}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

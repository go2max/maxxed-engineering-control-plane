// Accepted/rejected-outcome learning store.
//
// Persists structured, machine-readable trajectories of live engineering outcomes (accepted and
// rejected) so orchestration policies (routing, shard sizing, context selection, repair choice,
// test selection, scheduling priority, speculative fan-out) can later be trained/evaluated from
// real production evidence instead of synthetic data alone.
//
// Hard invariant (issue #71): this module stores NO hidden chain-of-thought. Only explicit,
// already-externalized artifacts are accepted: actions/tool calls actually taken, observations
// actually returned, decisions actually made, human/verifier-facing summaries, and machine-
// readable state (scores, verdicts, timings, costs). `redactTrajectory` enforces this by
// allow-listing fields rather than block-listing them, so an unknown/free-text field (a likely
// home for leaked reasoning or secrets) is dropped by default rather than passed through.
//
// This module is pure logic plus a thin JSONL append/read helper -- no network calls, no model
// calls. It extends the existing training authority (src/training/promotion-gate.js and
// src/training/score-benchmark.js) rather than creating a second one: outcome records feed the
// same per-domain benchmark/promotion pipeline those modules already define.
//
// reuse: internal -- built directly on this repo's existing training/benchmark/promotion-gate
// conventions (training/manifest.json domains, DomainScores shape, JSONL benchmark/eval files)
// rather than introducing a new storage format or a competing evaluation authority.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Fields allowed on a persisted trajectory record. Anything not listed here is dropped by
 * `redactTrajectory`. Keep this list aligned with the issue #71 "Required implementation" list.
 */
const ALLOWED_TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'recordId',
  'recordedAt',
  'taskClass',
  'sourceFingerprint',
  'executor',
  'shardSize',
  'contextBundleId',
  'actions',
  'verifierOutcomes',
  'repairPath',
  'cost',
  'latencyMs',
  'finalAcceptance',
  'rollbackOutcome',
  'productionOutcome',
  'summary',
  'labels',
  'split',
];

const ALLOWED_EXECUTOR_FIELDS = ['id', 'model', 'kind'];
const ALLOWED_ACTION_FIELDS = ['type', 'tool', 'target', 'result', 'ok', 'durationMs'];
const ALLOWED_VERIFIER_OUTCOME_FIELDS = ['name', 'verdict', 'detail', 'escapedToProduction'];
const ALLOWED_REPAIR_PATH_FIELDS = ['attempts', 'strategy', 'succeeded'];
const ALLOWED_COST_FIELDS = ['usd', 'tokensIn', 'tokensOut'];
const ALLOWED_LABEL_FIELDS = [
  'cheaperModelCouldSolve',
  'smallerShardWouldHaveSufficed',
  'largerShardWouldHaveBeenNeeded',
  'unnecessaryTestsRun',
  'repeatedFailure',
  'cacheOrReuseOpportunityMissed',
];

// Fields that are explicitly banned even if present on the input -- a denylist kept alongside the
// allowlist so an obvious secret/reasoning field produces a loud rejection instead of a silent
// drop during development, while the allowlist remains the actual enforcement mechanism.
const BANNED_FIELD_PATTERN = /(chainOfThought|rawReasoning|scratchpad|hiddenThinking|apiKey|secret|password|credential|authToken|accessToken|bearerToken|\bsecretToken\b)/i;

function pick(obj, allowedFields) {
  if (obj == null || typeof obj !== 'object') return obj;
  const out = {};
  for (const field of allowedFields) {
    if (field in obj) out[field] = obj[field];
  }
  return out;
}

function scanForBannedFields(obj, path = '') {
  if (obj == null || typeof obj !== 'object') return [];
  const hits = [];
  for (const key of Object.keys(obj)) {
    const full = path ? `${path}.${key}` : key;
    if (BANNED_FIELD_PATTERN.test(key)) hits.push(full);
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      hits.push(...scanForBannedFields(value, full));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => hits.push(...scanForBannedFields(item, `${full}[${i}]`)));
    }
  }
  return hits;
}

/**
 * Redact a raw trajectory down to the allow-listed, explicit-artifact shape. Throws if a
 * known-dangerous field name (secret/token/credential/hidden-reasoning) is present anywhere in
 * the input, since that is a strong signal the caller tried to persist something this store must
 * never hold -- silently dropping it would hide a real bug from the caller.
 *
 * @param {Object} raw
 * @returns {Object} redacted record, allow-listed fields only
 */
export function redactTrajectory(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('redactTrajectory requires an object');

  const bannedHits = scanForBannedFields(raw);
  if (bannedHits.length > 0) {
    throw new Error(
      `refusing to persist trajectory: banned field(s) present (${bannedHits.join(', ')}) -- ` +
        'the outcome store accepts only explicit artifacts/observations/decisions/summaries and machine-readable state, never secrets or hidden chain-of-thought'
    );
  }

  const record = pick(raw, ALLOWED_TOP_LEVEL_FIELDS);
  if (record.executor) record.executor = pick(record.executor, ALLOWED_EXECUTOR_FIELDS);
  if (Array.isArray(record.actions)) record.actions = record.actions.map((a) => pick(a, ALLOWED_ACTION_FIELDS));
  if (Array.isArray(record.verifierOutcomes)) {
    record.verifierOutcomes = record.verifierOutcomes.map((v) => pick(v, ALLOWED_VERIFIER_OUTCOME_FIELDS));
  }
  if (record.repairPath) record.repairPath = pick(record.repairPath, ALLOWED_REPAIR_PATH_FIELDS);
  if (record.cost) record.cost = pick(record.cost, ALLOWED_COST_FIELDS);
  if (record.labels) record.labels = pick(record.labels, ALLOWED_LABEL_FIELDS);
  if (typeof record.summary === 'object' && record.summary !== null) {
    // summaries must be plain text, not a nested object that could smuggle unreviewed fields
    throw new Error('summary must be a string, not an object');
  }

  return record;
}

const REQUIRED_FIELDS = ['taskClass', 'sourceFingerprint', 'executor', 'finalAcceptance'];

/**
 * Validate that a redacted record has the minimum fields required to be a useful training example.
 * @param {Object} record
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTrajectoryRecord(record) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) errors.push(`missing required field "${field}"`);
  }
  if (record.finalAcceptance !== undefined && !['accepted', 'rejected'].includes(record.finalAcceptance)) {
    errors.push(`finalAcceptance must be "accepted" or "rejected", got ${JSON.stringify(record.finalAcceptance)}`);
  }
  if (record.executor && !record.executor.model) errors.push('executor.model is required');
  return { valid: errors.length === 0, errors };
}

/**
 * Derive negative-trajectory / counterfactual labels from a redacted, validated record plus
 * optional comparative signals gathered elsewhere (e.g. a cheaper-model shadow replay, or a
 * cache-lookup result). Pure function; returns the `labels` object to merge onto the record.
 *
 * All heuristics are conservative (favor `false`/unset over an unsupported claim) since these
 * labels themselves become training signal.
 *
 * @param {Object} record - redacted trajectory record
 * @param {Object} [signals]
 * @param {boolean} [signals.cheaperModelSucceededInShadow] - a cheaper model was replayed against
 *   the same input (shadow, non-authoritative) and also succeeded.
 * @param {boolean} [signals.smallerShardSucceededInReplay]
 * @param {boolean} [signals.largerShardWasRequiredAfterRepair] - the shard had to be re-run/merged
 *   with a wider scope after an initial repair failure.
 * @param {boolean} [signals.reusableCacheEntryExistedButWasMissed]
 */
export function deriveCounterfactualLabels(record, signals = {}) {
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const verifierOutcomes = Array.isArray(record.verifierOutcomes) ? record.verifierOutcomes : [];
  const repairAttempts = record.repairPath?.attempts ?? 0;

  const testActions = actions.filter((a) => a.type === 'test' || a.tool === 'test');
  const failedTests = testActions.filter((a) => a.ok === false);
  // "Unnecessary tests" heuristic: acceptance succeeded overall, every test action passed, and
  // more than a token number of independent test actions ran -- a weak signal only, meant to
  // flag candidates for human/benchmark review, not to assert waste on its own.
  const unnecessaryTestsRun =
    record.finalAcceptance === 'accepted' && failedTests.length === 0 && testActions.length > 3;

  const repeatedFailure =
    repairAttempts >= 2 || verifierOutcomes.filter((v) => v.verdict === 'fail').length >= 2;

  const labels = {
    cheaperModelCouldSolve: signals.cheaperModelSucceededInShadow === true && record.finalAcceptance === 'accepted',
    smallerShardWouldHaveSufficed: signals.smallerShardSucceededInReplay === true,
    largerShardWouldHaveBeenNeeded: signals.largerShardWasRequiredAfterRepair === true,
    unnecessaryTestsRun,
    repeatedFailure,
    cacheOrReuseOpportunityMissed: signals.reusableCacheEntryExistedButWasMissed === true,
  };

  return labels;
}

/**
 * Build a complete, persistable trajectory record: redact, attach derived labels, stamp id/time,
 * and validate. Throws on invalid input rather than persisting a partial record.
 *
 * @param {Object} raw
 * @param {Object} [options]
 * @param {Object} [options.counterfactualSignals] - passed through to deriveCounterfactualLabels
 * @param {() => string} [options.now] - injectable clock for tests
 * @param {() => string} [options.idGenerator] - injectable id generator for tests
 * @returns {Object} the persistable record
 */
export function buildTrajectoryRecord(raw, options = {}) {
  const redacted = redactTrajectory(raw);
  const labels = { ...deriveCounterfactualLabels(redacted, options.counterfactualSignals ?? {}), ...(redacted.labels ?? {}) };

  const record = {
    schemaVersion: 1,
    recordId: redacted.recordId ?? (options.idGenerator ? options.idGenerator() : `outcome-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    recordedAt: redacted.recordedAt ?? (options.now ? options.now() : new Date().toISOString()),
    split: redacted.split ?? 'train',
    ...redacted,
    labels,
  };

  const { valid, errors } = validateTrajectoryRecord(record);
  if (!valid) throw new Error(`invalid trajectory record: ${errors.join('; ')}`);

  return record;
}

/**
 * Guard against a record contaminating the held-out benchmark: a record whose `split` is
 * "train" (default) must not share a `sourceFingerprint` with any case in the given held-out
 * benchmark case-id/fingerprint set. Call this before appending to a train log.
 *
 * @param {Object} record
 * @param {Set<string>|string[]} heldOutFingerprints
 * @throws if the record's split is "train" and its fingerprint collides with a held-out case
 */
export function assertNoBenchmarkLeak(record, heldOutFingerprints) {
  const heldOut = heldOutFingerprints instanceof Set ? heldOutFingerprints : new Set(heldOutFingerprints ?? []);
  if (record.split === 'train' && heldOut.has(record.sourceFingerprint)) {
    throw new Error(
      `refusing to append record ${record.recordId}: sourceFingerprint "${record.sourceFingerprint}" collides with a held-out benchmark case (would leak into training data)`
    );
  }
}

/**
 * Append one record as a JSONL line to `logPath`, creating parent directories as needed.
 * @param {Object} record
 * @param {string} logPath
 */
export function appendOutcomeRecord(record, logPath) {
  const dir = dirname(logPath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Read all records from a JSONL outcome log. Returns [] if the file does not exist.
 * @param {string} logPath
 * @returns {Object[]}
 */
export function readOutcomeLog(logPath) {
  if (!existsSync(logPath)) return [];
  const text = readFileSync(logPath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Split a set of records into a task-class benchmark slice and the remaining training pool,
 * for building per-domain/task-class benchmark slices from held-out data (issue #71 requirement).
 * Selection is deterministic (stable sort by recordId) so the same input always produces the same
 * slice, which callers can further sample from.
 *
 * @param {Object[]} records
 * @param {string} taskClass
 * @param {number} [holdoutFraction=0.2]
 * @returns {{ benchmarkSlice: Object[], trainingPool: Object[] }}
 */
export function buildTaskClassBenchmarkSlice(records, taskClass, holdoutFraction = 0.2) {
  if (holdoutFraction < 0 || holdoutFraction > 1) throw new Error('holdoutFraction must be between 0 and 1');
  const inClass = records
    .filter((r) => r.taskClass === taskClass && r.split !== 'benchmark')
    .slice()
    .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0));
  const holdoutCount = Math.max(inClass.length > 0 ? 1 : 0, Math.round(inClass.length * holdoutFraction));
  const benchmarkSlice = inClass.slice(0, holdoutCount).map((r) => ({ ...r, split: 'benchmark' }));
  const benchmarkIds = new Set(benchmarkSlice.map((r) => r.recordId));
  const trainingPool = records.filter((r) => !benchmarkIds.has(r.recordId));
  return { benchmarkSlice, trainingPool };
}

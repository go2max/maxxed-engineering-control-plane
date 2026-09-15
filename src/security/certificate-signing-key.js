// Single-process certificate signing authority (security review findings 1 & 3).
//
// Both certificate systems in this repo (EconomicImpactCertificate and the proof certificate in
// src/verification/proof-certificate.js) previously "sealed" themselves with a plain, unkeyed
// SHA-256 digest computed by an algorithm exported from the same module. That is a corruption
// checksum, not a signature: anyone able to construct an object could construct a valid-looking
// certificate, or mutate a real one and recompute its seal.
//
// This module holds the one symmetric key both the issuing side and the verifying side use, so a
// certificate is trusted only when it carries an HMAC-SHA256 that verifies under the *current*
// process key. HMAC (not asymmetric signing) is sufficient here because issuance and verification
// happen inside the same control-plane process: the trust boundary is "code running inside the
// control plane" vs. "agent-supplied task metadata", not mutual distrust between separate parties.
// If certificates ever have to be verified by a different process/party, this is the single place
// that would switch to Ed25519.
//
// Key handling rules (enforced by keeping the key module-private):
//   - configured via the MAXXED_CERTIFICATE_SIGNING_KEY env var, otherwise a random 32-byte key is
//     generated on first use and lives only in this module's memory for the process lifetime;
//   - never exported, never returned by any function, never logged, never serialized into a
//     certificate, an error message or any HTTP response;
//   - a process restart without the env var rotates the key, which correctly invalidates
//     certificates issued by a previous process (they must be re-issued from real evidence).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** Stable canonical serialization — the same key-sorted JSON shape the existing digest() helpers use. */
export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

let signingKey = null;

function materializeKey() {
  const configured = process.env.MAXXED_CERTIFICATE_SIGNING_KEY;
  if (typeof configured === 'string' && configured.length > 0) {
    // Accept hex or raw text; both are fed through HMAC, so length is not security-critical beyond
    // the operator's own choice of secret.
    const hex = /^[0-9a-f]+$/i.test(configured) && configured.length % 2 === 0;
    return hex ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'utf8');
  }
  return randomBytes(32);
}

function key() {
  if (!signingKey) signingKey = materializeKey();
  return signingKey;
}

/**
 * HMAC-SHA256 over the canonical serialization of `payload`, returned as hex.
 * The returned value is a signature over the content only — it never encodes the key itself.
 */
export function signCertificatePayload(payload) {
  return createHmac('sha256', key()).update(canonicalJson(payload)).digest('hex');
}

/**
 * Timing-safe verification of a certificate signature. Returns false (never throws, never reports
 * *why* beyond true/false) for a missing, malformed, wrong-length or non-matching signature.
 */
export function verifyCertificatePayload(payload, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signCertificatePayload(payload), 'hex');
  const presented = Buffer.from(signature.toLowerCase(), 'hex');
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

/**
 * TEST-ONLY: forces the next signing/verification call to materialize a fresh key from the current
 * environment. Used to prove that certificates signed under a different key are rejected. It only
 * ever discards the in-memory key; it can neither read nor export it.
 */
export function resetSigningKeyForTests() {
  signingKey = null;
}

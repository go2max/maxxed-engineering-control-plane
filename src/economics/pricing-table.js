// Local, versioned pricing table used to convert raw resource-usage evidence into USD cost
// estimates. Deliberately a plain, in-repo data module -- no network calls, no Infracost/
// OpenCost/Datadog/New Relic or any other hosted pricing/observability dependency. External cost
// systems may exist later as optional adapters that *populate* evidence, but this table is always
// the local authority the issuer prices against.
//
// Bumping PRICING_TABLE_VERSION is a deliberate, reviewed act (the version travels inside every
// issued certificate's measurements/provenance trail via the issuer, so estimates stay
// attributable to the table that produced them).

export const PRICING_TABLE_VERSION = 'pricing-v1';

export const pricingTable = Object.freeze({
  version: PRICING_TABLE_VERSION,
  // Compute / build
  computeMsUsd: 0.00000005,       // ~$0.05 per 1M ms of CPU/GPU/worker runtime
  ciBuildMinuteUsd: 0.008,        // typical hosted CI runner minute
  // Database
  dbReadUsd: 0.0000002,
  dbWriteUsd: 0.000001,
  dbScanUsd: 0.00005,
  // Storage / network
  storageGbMonthUsd: 0.023,
  egressGbUsd: 0.09,
  loggingGbUsd: 0.05,
  // External APIs
  externalApiCallUsd: 0.001,
  // Model/token spend, by model id. `default` is used for any model not explicitly listed.
  modelTokenUsd: {
    default: { inputPerTokenUsd: 0.000003, outputPerTokenUsd: 0.000015 },
    'claude-haiku': { inputPerTokenUsd: 0.0000008, outputPerTokenUsd: 0.000004 },
    'claude-sonnet': { inputPerTokenUsd: 0.000003, outputPerTokenUsd: 0.000015 },
    'claude-opus': { inputPerTokenUsd: 0.000015, outputPerTokenUsd: 0.000075 }
  },
  minutesPerMonth: 43_800
});

export function modelRateFor(pricing, model) {
  return pricing.modelTokenUsd[model] ?? pricing.modelTokenUsd.default;
}

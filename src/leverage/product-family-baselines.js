export const CANONICAL_PRODUCT_FAMILIES = Object.freeze({
  'saas-web': {
    version: '1',
    features: { auth: true, tenantIsolation: true, billingEntitlements: true, admin: true, telemetry: true, email: true, storage: true, security: true, ci: true, deployment: true, testing: true, docs: true, legal: true, support: true, health: true, rollback: true },
    policy: { exactShaPromotion: true, productionVerification: true, secretScanning: true, accessibilityGate: true, browserGate: true }
  },
  'wordpress-plugin': {
    version: '1',
    features: { settingsPage: true, aboutPage: true, liteProBoundary: true, upgradeAction: true, licenseAction: true, uninstallSafety: true, capabilityChecks: true, nonceChecks: true, escaping: true, sanitization: true, i18n: true, readme: true, changelog: true, screenshotsPlan: true, packageValidation: true, directoryEvidence: true, tests: true },
    policy: { proPrivate: true, litePublicReady: true, exactArtifactChecksum: true, wordpressOrgHumanGate: true }
  },
  'android-app': {
    version: '1',
    features: { gradleRelease: true, permissionModel: true, privacyDisclosure: true, settings: true, telemetry: true, crashEvidence: true, offlineBehavior: true, accessibility: true, unitTests: true, instrumentationContract: true, signedBundleContract: true, storeMetadata: true, rollback: true },
    policy: { signingHumanOwned: true, deviceAcceptanceGate: true, exactArtifactChecksum: true, targetSdkPolicy: 'current-supported' }
  },
  'unity-game': {
    version: '1',
    features: { deterministicScenes: true, navigation: true, persistence: true, inputSafety: true, androidBuild: true, privacyDisclosure: true, adsBoundary: true, metricsBoundary: true, help: true, credits: true, playModeTests: true, buildValidation: true, crashEvidence: true },
    policy: { storeSubmissionHumanGate: true, deviceAcceptanceGate: true, exactArtifactChecksum: true, noEditorOnlyRuntimeDependency: true }
  }
});

export function registerCanonicalProductFamilies(planner) {
  if (!planner?.registerBaseline) throw new Error('product family planner is required');
  return Object.entries(CANONICAL_PRODUCT_FAMILIES).map(([family, baseline]) => planner.registerBaseline({ family, ...baseline }));
}

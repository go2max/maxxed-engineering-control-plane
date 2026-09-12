# Product Factories

## Objective

Raise leverage by making products instances of governed shared platforms rather than independent greenfield systems.

## Initial factories

### WordPress commercial plugin factory
Standardize Lite/Pro shell, settings/about, upgrade/license surfaces, packaging, release evidence, WordPress.org flow, telemetry, product-page linkage and support/release metadata.

### Android utility factory
Standardize Gradle/build conventions, permissions, storage, CameraX/sensors/location where relevant, release signing workflow, telemetry, QA matrix and Play release evidence.

### Web/SaaS factory
Standardize auth/identity boundaries, billing/entitlements, observability, storage, email, deployment, browser acceptance and protected Admin integration.

### Static/business-site factory
Standardize routing, SEO/schema, analytics, forms, performance/accessibility, deployment and content-governance contracts.

### Unity/game factory
Standardize project foundation, identity/preferences, navigation/help/settings, save/runtime fallbacks, ads/metrics abstractions, Android release and repeatable acceptance.

## Shared platform

`maxxed-shared-sdk` should absorb mature reusable capabilities only after contracts prove portable. Factory implementations consume shared primitives rather than copying code between products.

## Factory metric

Track owner attention and accepted human-equivalent effort by product family. A factory is successful when incremental products require progressively less bespoke work without increasing regression/rework rate.

## Drift control

Consumers declare factory/platform version. Architecture drift and duplicated local implementations should be detected and queued for bounded migration rather than silently diverging.

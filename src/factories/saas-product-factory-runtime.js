import { SaasWebFactory } from './saas-web-factory.js';
import { WebFactoryExecutor } from './web-factory-executor.js';
import { buildBaselineContract, resolveProductDelta } from './saas-baseline.js';
import { buildPromotionRecord, buildRollbackPlan, productionAcceptanceRecord, verifyPromotionLineage } from './environment-promotion.js';
import { SaasReleaseLedger } from './saas-release-ledger.js';

export class SaasProductFactoryRuntime {
  constructor({ taskSink = null, repairPlanner = null, ledger = new SaasReleaseLedger() } = {}) {
    this.factory = new SaasWebFactory();
    this.executor = new WebFactoryExecutor({ factory: this.factory, repairPlanner });
    this.taskSink = taskSink;
    this.ledger = ledger;
    this.runs = new Map();
  }

  createProduct(input, now = Date.now()) {
    const run = this.factory.createRun(input);
    const tasks = this.factory.requiredTaskTemplates(run);
    const deltaTasks = this.#deltaTasks(run);
    const allTasks = [...deltaTasks, ...tasks];
    if (this.taskSink) for (const task of allTasks) this.taskSink(task);
    this.runs.set(run.runId, structuredClone(run));
    this.ledger.record({ productKey: run.productKey, kind: 'factory-run-created', runId: run.runId, specDigest: run.specDigest, status: run.state, metadata: { baselineVersion: run.baseline.specification.baselineVersion, reuseRate: resolveProductDelta({ spec: run.spec }).reuseRate, taskCount: allTasks.length } }, now);
    return { run: structuredClone(run), tasks: allTasks.map((task) => structuredClone(task)), baseline: structuredClone(run.baseline) };
  }

  createFamily({ familyKey, products = [], baselineVersion = 'saas-web-v1' } = {}, now = Date.now()) {
    if (!familyKey || !Array.isArray(products) || !products.length) throw new Error('familyKey and products are required');
    const planned = products.map((product) => this.createProduct({ ...product, spec: { ...(product.spec ?? {}), baselineVersion } }, now));
    const sharedFoundations = planned[0].baseline.requiredFoundations;
    const deltas = planned.map(({ run, baseline }) => ({ productKey: run.productKey, specDigest: run.specDigest, productDelta: baseline.productDelta }));
    return {
      familyKey,
      baselineVersion,
      sharedFoundations,
      sharedFoundationInstances: 1,
      productCount: planned.length,
      products: planned,
      deltas
    };
  }

  nextJob(runId) {
    const run = this.#requireRun(runId);
    return this.executor.nextJob(run);
  }

  applyStageEvidence(runId, evidence, now = Date.now()) {
    const run = this.#requireRun(runId);
    const stage = this.factory.currentStage(run);
    const result = this.executor.applyEvidence(run, evidence);
    this.runs.set(runId, structuredClone(result.run));
    this.ledger.record({ productKey: run.productKey, kind: result.validation.ok ? 'stage-accepted' : 'stage-failed', runId, specDigest: run.specDigest, status: result.run.state, metadata: { stage, validation: result.validation, failure: result.failure, repairPlan: result.repairPlan } }, now);
    return result;
  }

  promote(runId, input, now = Date.now()) {
    const run = this.#requireRun(runId);
    if (run.state !== 'ACCEPTED') throw new Error('only accepted factory runs may be promoted');
    const acceptedCommitSha = run.evidence?.ACCEPT?.acceptedCommitSha;
    if (!acceptedCommitSha) throw new Error('accepted run is missing acceptedCommitSha');
    const promotion = buildPromotionRecord({ ...input, productKey: run.productKey, repository: run.repository, commitSha: input.commitSha, specDigest: run.specDigest });
    const lineage = verifyPromotionLineage({ promotion, acceptedCommitSha, acceptedSpecDigest: run.specDigest });
    if (!lineage.ok) throw new Error(lineage.reason);
    this.ledger.record({ productKey: run.productKey, kind: 'promoted', runId, specDigest: run.specDigest, commitSha: promotion.commitSha, deploymentId: promotion.deploymentId, status: 'PROMOTED', metadata: { environment: promotion.environment, url: promotion.url, acceptanceBundleId: promotion.acceptanceBundleId } }, now);
    return promotion;
  }

  verifyProduction(runId, promotion, evidence, now = Date.now()) {
    const run = this.#requireRun(runId);
    const record = productionAcceptanceRecord({ promotion, ...evidence });
    if (record.accepted) {
      this.ledger.record({ productKey: run.productKey, kind: 'production-accepted', runId, specDigest: run.specDigest, commitSha: promotion.commitSha, deploymentId: promotion.deploymentId, status: 'LIVE', metadata: record }, now);
      return { status: 'LIVE', acceptance: record, rollbackPlan: null };
    }
    const rollbackPlan = buildRollbackPlan(promotion, { reason: `production verification failed: ${record.failures.join(',')}` });
    this.ledger.record({ productKey: run.productKey, kind: 'production-rejected', runId, specDigest: run.specDigest, commitSha: promotion.commitSha, deploymentId: promotion.deploymentId, status: 'ROLLBACK_REQUIRED', metadata: { acceptance: record, rollbackPlan } }, now);
    return { status: 'ROLLBACK_REQUIRED', acceptance: record, rollbackPlan };
  }

  productStatus(productKey) {
    const latest = this.ledger.latest(productKey);
    const live = this.ledger.latest(productKey, 'production-accepted');
    return { productKey, latest: latest ? structuredClone(latest) : null, live: live ? structuredClone(live) : null, history: this.ledger.forProduct(productKey) };
  }

  snapshot() { return { version: 1, runs: [...this.runs.entries()], ledger: this.ledger.snapshot() }; }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new Error('unsupported SaaS product factory snapshot');
    this.runs = new Map((snapshot.runs ?? []).map(([key, value]) => [key, structuredClone(value)]));
    this.ledger.restore(snapshot.ledger);
  }

  #deltaTasks(run) {
    return run.baseline.productDelta.map((capability) => ({
      key: `${run.runId}:delta:${capability}`,
      repository: run.repository,
      product: run.productKey,
      objective: `Implement product-specific capability: ${capability}`,
      dependencies: [],
      taskClass: 'implementation',
      requirements: {},
      dedupeKey: `${run.productKey}:${run.specDigest}:delta:${capability}`,
      metadata: { factory: 'saas-web', factoryRunId: run.runId, specDigest: run.specDigest, baselineVersion: run.baseline.specification.baselineVersion, productDeltaCapability: capability }
    }));
  }

  #requireRun(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown factory run: ${runId}`);
    return structuredClone(run);
  }
}

export function planProductFamily({ familyKey, products, baselineVersion = 'saas-web-v1' } = {}) {
  if (!familyKey || !Array.isArray(products) || !products.length) throw new Error('familyKey and products are required');
  const planned = products.map((product) => ({
    productKey: product.productKey,
    repository: product.repository,
    baseline: buildBaselineContract({ productKey: product.productKey, repository: product.repository, spec: { ...(product.spec ?? {}), baselineVersion } })
  }));
  return {
    familyKey,
    baselineVersion,
    sharedFoundations: planned[0].baseline.requiredFoundations,
    sharedFoundationInstances: 1,
    products: planned.map(({ productKey, repository, baseline }) => ({ productKey, repository, specDigest: baseline.specification.digest, productDelta: baseline.productDelta }))
  };
}

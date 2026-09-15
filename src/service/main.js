import os from 'node:os';
import path from 'node:path';
import { ControlPlaneRuntime } from './control-plane-runtime.js';
import { createFabricWorkerProvider } from './fabric-worker-provider.js';
import { FabricExecutionClient } from './fabric-execution-client.js';
import { AutonomousCodingLoop } from './autonomous-coding-loop.js';
import { GitHubPullRequestAdapter } from './github-pr-adapter.js';
import { PullRequestPromotion } from './pr-promotion.js';
import { createControlPlaneServer } from './http-server.js';
import { RuntimeStateStore } from '../core/runtime-state.js';
import { SolutionCAS } from '../leverage/solution-cas.js';
import { SemanticCodeGraph } from '../leverage/semantic-code-graph.js';
import { TransformRegistry } from '../leverage/transform-registry.js';
import { TrajectoryHarvester } from '../leverage/trajectory-harvester.js';
import { RepairMemory } from '../leverage/repair-memory.js';
import { LeverageEngine } from '../leverage/leverage-engine.js';
import { LeverageRuntimeAdapter } from '../leverage/runtime-adapter.js';
import { ArtifactCache } from '../leverage/artifact-cache.js';
import { FileArtifactStore } from '../leverage/content-addressed-artifact-store.js';
import { ProductFamilyPlanner } from '../leverage/product-family-planner.js';
import { CANONICAL_PRODUCT_FAMILIES } from '../leverage/product-family-baselines.js';
import { CapabilityGraph } from '../leverage/capability-graph.js';
import { mineAbstractions } from '../leverage/abstraction-miner.js';
import { readOutcomeLog } from '../training/outcome-store.js';
import { BottleneckOptimizer } from '../leverage/bottleneck-optimizer.js';
import { MaintenancePlanner } from '../leverage/maintenance-planner.js';
import { defaultControlPlaneReplayProjector } from '../leverage/execution-replay.js';
import { SourceIndexer } from '../leverage/source-indexer.js';
import { CodeIndexAdapterRegistry, ScipIndexAdapter } from '../leverage/code-index-adapters.js';
import { ContextCompiler } from '../leverage/context-compiler.js';
import { SpeculativePlanner } from '../leverage/speculative-planner.js';
import { DerivedStateManager } from '../leverage/derived-state.js';
import { ToolResultCache } from '../leverage/tool-result-cache.js';
import { ExecutionCheckpointStore } from '../leverage/execution-checkpoint.js';
import { ImpactTestSelector } from '../verification/impact-test-selector.js';
import { TestReliabilityLedger } from '../verification/test-reliability.js';
import { ChallengeSuiteScheduler } from '../verification/challenge-suite-scheduler.js';
import { WorkerPerformanceLedger } from '../scheduler/worker-performance.js';
import { MicroShardPlanner } from '../patch/shard-planner.js';
import { PatchFabric } from '../patch/patch-fabric.js';
import { MicroShardCoordinator } from '../patch/micro-shard-coordinator.js';
import { EvidenceGraph, CertificateCache } from '../verification/proof-certificate.js';

const host = process.env.MAXXED_CONTROL_HOST ?? '127.0.0.1';
const port = Number(process.env.MAXXED_CONTROL_PORT ?? 7790);
const adminToken = process.env.MAXXED_CONTROL_ADMIN_TOKEN ?? '';
if (!adminToken) throw new Error('MAXXED_CONTROL_ADMIN_TOKEN is required');

const stateDir = process.env.MAXXED_CONTROL_STATE_DIR ?? path.join(os.homedir(), '.maxxed-control-plane');
const statePath = process.env.MAXXED_CONTROL_STATE_PATH ?? path.join(stateDir, 'state.json');
const leverageStatePath = process.env.MAXXED_LEVERAGE_STATE_PATH ?? path.join(stateDir, 'leverage.json');
const patchStatePath = process.env.MAXXED_PATCH_STATE_PATH ?? path.join(stateDir, 'patch-fabric.json');
const artifactStorePath = process.env.MAXXED_ARTIFACT_STORE_PATH ?? path.join(stateDir, 'artifact-cas');
const persistMs = Number(process.env.MAXXED_CONTROL_PERSIST_MS ?? 1000);
const fabricUrl = process.env.MAXXED_FABRIC_URL ?? 'http://127.0.0.1:7788';
const fabricAdminToken = process.env.MAXXED_FABRIC_ADMIN_TOKEN ?? '';
const githubToken = process.env.MAXXED_GITHUB_TOKEN ?? '';
const fleetCacheTtlMs = Number(process.env.MAXXED_FLEET_CACHE_TTL_MS ?? 2000);
const toolResultCache = new ToolResultCache({ maxEntries: Number(process.env.MAXXED_TOOL_CACHE_MAX ?? 20000), defaultTtlMs: Number(process.env.MAXXED_TOOL_CACHE_TTL_MS ?? 60000) });
const workerProvider = createFabricWorkerProvider({ baseUrl: fabricUrl, adminToken: fabricAdminToken, toolResultCache, cacheTtlMs: fleetCacheTtlMs });
const fabricExecutionClient = fabricAdminToken ? new FabricExecutionClient({ baseUrl: fabricUrl, adminToken: fabricAdminToken, toolResultCache, fleetCacheTtlMs }) : null;
const workerPerformance = new WorkerPerformanceLedger();
const runtime = new ControlPlaneRuntime({
  workerProvider,
  fabricExecutionClient,
  schedulerOptions: { performanceLedger: workerPerformance },
  throughputOptions: {
    baselineConcurrency: Number(process.env.MAXXED_BASELINE_CONCURRENCY ?? 2),
    targetMultiplier: Number(process.env.MAXXED_TARGET_MULTIPLIER ?? 2),
    maxConcurrency: Number(process.env.MAXXED_MAX_CONCURRENCY ?? 16),
    maxVerifierBacklog: Number(process.env.MAXXED_MAX_VERIFIER_BACKLOG ?? 8),
    maxFailureRate: Number(process.env.MAXXED_MAX_FAILURE_RATE ?? 0.2)
  }
});

const solutionCas = new SolutionCAS({ maxEntries: Number(process.env.MAXXED_SOLUTION_CACHE_MAX ?? 10000) });
const artifactCache = new ArtifactCache({ maxEntries: Number(process.env.MAXXED_ARTIFACT_CACHE_MAX ?? 50000) });
const artifactStore = new FileArtifactStore({ root: artifactStorePath, maxBytes: Number(process.env.MAXXED_ARTIFACT_STORE_MAX_BYTES ?? 20 * 1024 * 1024 * 1024) });
const semanticGraph = new SemanticCodeGraph();
const transforms = new TransformRegistry();
const trajectoryHarvester = new TrajectoryHarvester({ maxRecords: Number(process.env.MAXXED_TRAJECTORY_MAX ?? 50000) });
const repairMemory = new RepairMemory();
const productFamilies = new ProductFamilyPlanner();
const capabilityGraph = new CapabilityGraph({ graph: semanticGraph });
const outcomeLogPath = process.env.MAXXED_OUTCOME_LOG_PATH ?? path.join(stateDir, 'outcomes.jsonl');
const abstractionMiner = (options = {}) => mineAbstractions(readOutcomeLog(options.logPath ?? outcomeLogPath), options);
const bottleneckOptimizer = new BottleneckOptimizer();
const maintenancePlanner = new MaintenancePlanner();
const replayProjector = defaultControlPlaneReplayProjector();
const sourceIndexer = new SourceIndexer({ graph: semanticGraph });
const codeIndexes = new CodeIndexAdapterRegistry();
codeIndexes.register('scip', new ScipIndexAdapter({ graph: semanticGraph }));
const contextCompiler = new ContextCompiler({ graph: semanticGraph, cas: solutionCas, repairs: repairMemory });
const speculativePlanner = new SpeculativePlanner({ maxCandidates: Number(process.env.MAXXED_SPECULATIVE_MAX_CANDIDATES ?? 4), minValueToCostRatio: Number(process.env.MAXXED_SPECULATIVE_MIN_VALUE_COST ?? 3) });
const impactTestSelector = new ImpactTestSelector({ graph: semanticGraph });
const testReliability = new TestReliabilityLedger();
const challengeSuiteScheduler = new ChallengeSuiteScheduler({
  everyNTargeted: Number(process.env.MAXXED_CHALLENGE_EVERY_N ?? 8),
  minIntervalMs: Number(process.env.MAXXED_CHALLENGE_MIN_INTERVAL_MS ?? 30 * 60 * 1000)
});
const shardPlanner = new MicroShardPlanner();
const patchFabric = new PatchFabric();
const evidenceGraph = new EvidenceGraph();
const certificateCache = new CertificateCache();
const microShards = new MicroShardCoordinator({ runtime, patchFabric, shardPlanner, evidenceGraph, certificateCache });
const leverageEngine = new LeverageEngine({ cas: solutionCas, graph: semanticGraph, transforms, repairs: repairMemory });
const leverage = new LeverageRuntimeAdapter({ runtime, engine: leverageEngine, cas: solutionCas, harvester: trajectoryHarvester, repairs: repairMemory });
const derivedState = new DerivedStateManager({ solutionCas, artifactCache, semanticGraph, trajectoryHarvester, repairMemory });
const executionCheckpoints = new ExecutionCheckpointStore({ maxEntries: Number(process.env.MAXXED_CHECKPOINT_MAX ?? 5000) });
const leverageComponents = {
  leverage, solutionCas, artifactCache, artifactStore, semanticGraph, transforms, trajectoryHarvester, repairMemory,
  productFamilies, capabilityGraph, abstractionMiner, bottleneckOptimizer, maintenancePlanner, replayProjector, sourceIndexer, codeIndexes, contextCompiler,
  speculativePlanner, impactTestSelector, testReliability, challengeSuiteScheduler, workerPerformance, shardPlanner, patchFabric, microShards, derivedState, leverageEngine,
  toolResultCache, executionCheckpoints, evidenceGraph, certificateCache
};

const store = new RuntimeStateStore(statePath);
const leverageStore = new RuntimeStateStore(leverageStatePath);
const patchStore = new RuntimeStateStore(patchStatePath);
const restored = await store.load();
if (restored) runtime.restore(restored);
const restoredLeverage = await leverageStore.load();
if ([1,2,3,4,5,6,7].includes(restoredLeverage?.version)) {
  solutionCas.restore(restoredLeverage.solutionCas);
  artifactCache.restore(restoredLeverage.artifactCache);
  semanticGraph.restore(restoredLeverage.semanticGraph);
  trajectoryHarvester.restore(restoredLeverage.trajectories);
  repairMemory.restore(restoredLeverage.repairMemory);
  productFamilies.restore(restoredLeverage.productFamilies);
  transforms.restore(restoredLeverage.transforms);
  if (restoredLeverage.workerPerformance) workerPerformance.restore(restoredLeverage.workerPerformance);
  if (restoredLeverage.testReliability) testReliability.restore(restoredLeverage.testReliability);
  if (restoredLeverage.toolResultCache) toolResultCache.restore(restoredLeverage.toolResultCache);
  if (restoredLeverage.executionCheckpoints) executionCheckpoints.restore(restoredLeverage.executionCheckpoints);
  if (restoredLeverage.shardPlanner) shardPlanner.restore(restoredLeverage.shardPlanner);
  if (restoredLeverage.challengeSuiteScheduler) challengeSuiteScheduler.restore(restoredLeverage.challengeSuiteScheduler);
  if (restoredLeverage.evidenceGraph) {
    const restoredGraph = EvidenceGraph.restore(restoredLeverage.evidenceGraph);
    evidenceGraph.nodes = restoredGraph.nodes;
    evidenceGraph.edges = restoredGraph.edges;
  }
  if (restoredLeverage.certificateCache) {
    const restoredCache = CertificateCache.restore(restoredLeverage.certificateCache);
    certificateCache.byFingerprint = restoredCache.byFingerprint;
    certificateCache.invalidated = restoredCache.invalidated;
  }
}
for (const [family, baseline] of Object.entries(CANONICAL_PRODUCT_FAMILIES)) if (!productFamilies.baselines.has(family)) productFamilies.registerBaseline({ family, ...baseline });
const restoredPatch = await patchStore.load();
if (restoredPatch) patchFabric.restore(restoredPatch);

const githubAdapter = githubToken ? new GitHubPullRequestAdapter({ token: githubToken }) : null;
const promotion = githubAdapter ? new PullRequestPromotion({ runtime, adapter: githubAdapter }) : null;
const codingLoop = fabricExecutionClient ? new AutonomousCodingLoop({ runtime, fabricClient: fabricExecutionClient, promotion, leverage, workerPerformance, microShards, intervalMs: Number(process.env.MAXXED_CODING_LOOP_MS ?? 2_000) }) : null;
const server = createControlPlaneServer({ runtime, adminToken, codingLoop, leverageComponents });
let saving = false;
const persist = async () => {
  if (saving) return;
  saving = true;
  try {
    await store.save(runtime.snapshot());
    await patchStore.save(patchFabric.snapshot());
    await leverageStore.save({
      version: 7,
      solutionCas: solutionCas.snapshot(),
      artifactCache: artifactCache.snapshot(),
      semanticGraph: semanticGraph.snapshot(),
      trajectories: trajectoryHarvester.snapshot(),
      repairMemory: repairMemory.snapshot(),
      productFamilies: productFamilies.snapshot(),
      transforms: transforms.snapshot(),
      workerPerformance: workerPerformance.snapshot(),
      testReliability: testReliability.snapshot(),
      toolResultCache: toolResultCache.snapshot(),
      executionCheckpoints: executionCheckpoints.snapshot(),
      shardPlanner: shardPlanner.snapshot(),
      challengeSuiteScheduler: challengeSuiteScheduler.snapshot(),
      evidenceGraph: evidenceGraph.snapshot(),
      certificateCache: certificateCache.snapshot()
    });
  } catch (error) { console.error(JSON.stringify({ event: 'control-plane-persistence-failed', error: error.message })); }
  finally { saving = false; }
};
const timer = setInterval(() => void persist(), persistMs);
timer.unref();

server.listen(port, host, () => {
  console.log(`maxxed engineering control plane listening on http://${host}:${port}`);
  console.log(`leverage fabric active: solutions=${solutionCas.entries.size}, artifacts=${artifactCache.entries.size}, trajectories=${trajectoryHarvester.records.length}, patchSessions=${patchFabric.sessions.size}`);
  if (codingLoop) {
    codingLoop.start();
    console.log(`autonomous coding loop active at ${runtime.throughput.targetMultiplier}x baseline target`);
    console.log('Patch Fabric micro-lanes are enabled for exact-SHA tasks with profitable decomposable units.');
    console.log(githubAdapter ? 'accepted coding branches will be promoted to GitHub PRs' : 'GitHub PR promotion disabled: MAXXED_GITHUB_TOKEN is not configured');
  } else console.log('autonomous coding loop disabled: MAXXED_FABRIC_ADMIN_TOKEN is not configured');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(timer);
    codingLoop?.stop();
    runtime.pause();
    await persist();
    server.close(() => process.exit(0));
  });
}

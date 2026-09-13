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
import { ProductFamilyPlanner } from '../leverage/product-family-planner.js';
import { BottleneckOptimizer } from '../leverage/bottleneck-optimizer.js';
import { MaintenancePlanner } from '../leverage/maintenance-planner.js';
import { defaultControlPlaneReplayProjector } from '../leverage/execution-replay.js';

const host = process.env.MAXXED_CONTROL_HOST ?? '127.0.0.1';
const port = Number(process.env.MAXXED_CONTROL_PORT ?? 7790);
const adminToken = process.env.MAXXED_CONTROL_ADMIN_TOKEN ?? '';
if (!adminToken) throw new Error('MAXXED_CONTROL_ADMIN_TOKEN is required');

const statePath = process.env.MAXXED_CONTROL_STATE_PATH ?? path.join(os.homedir(), '.maxxed-control-plane', 'state.json');
const leverageStatePath = process.env.MAXXED_LEVERAGE_STATE_PATH ?? path.join(os.homedir(), '.maxxed-control-plane', 'leverage.json');
const persistMs = Number(process.env.MAXXED_CONTROL_PERSIST_MS ?? 1000);
const fabricUrl = process.env.MAXXED_FABRIC_URL ?? 'http://127.0.0.1:7788';
const fabricAdminToken = process.env.MAXXED_FABRIC_ADMIN_TOKEN ?? '';
const githubToken = process.env.MAXXED_GITHUB_TOKEN ?? '';
const workerProvider = createFabricWorkerProvider({ baseUrl: fabricUrl, adminToken: fabricAdminToken });
const fabricExecutionClient = fabricAdminToken ? new FabricExecutionClient({ baseUrl: fabricUrl, adminToken: fabricAdminToken }) : null;
const runtime = new ControlPlaneRuntime({
  workerProvider,
  fabricExecutionClient,
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
const semanticGraph = new SemanticCodeGraph();
const transforms = new TransformRegistry();
const trajectoryHarvester = new TrajectoryHarvester({ maxRecords: Number(process.env.MAXXED_TRAJECTORY_MAX ?? 50000) });
const repairMemory = new RepairMemory();
const productFamilies = new ProductFamilyPlanner();
const bottleneckOptimizer = new BottleneckOptimizer();
const maintenancePlanner = new MaintenancePlanner();
const replayProjector = defaultControlPlaneReplayProjector();
const leverageEngine = new LeverageEngine({ cas: solutionCas, graph: semanticGraph, transforms, repairs: repairMemory });
const leverage = new LeverageRuntimeAdapter({ runtime, engine: leverageEngine, cas: solutionCas, harvester: trajectoryHarvester });
const leverageComponents = { leverage, solutionCas, artifactCache, semanticGraph, transforms, trajectoryHarvester, repairMemory, productFamilies, bottleneckOptimizer, maintenancePlanner, replayProjector, leverageEngine };

const store = new RuntimeStateStore(statePath);
const leverageStore = new RuntimeStateStore(leverageStatePath);
const restored = await store.load();
if (restored) runtime.restore(restored);
const restoredLeverage = await leverageStore.load();
if (restoredLeverage?.version === 2 || restoredLeverage?.version === 1) {
  solutionCas.restore(restoredLeverage.solutionCas);
  artifactCache.restore(restoredLeverage.artifactCache);
  semanticGraph.restore(restoredLeverage.semanticGraph);
  trajectoryHarvester.restore(restoredLeverage.trajectories);
  repairMemory.restore(restoredLeverage.repairMemory);
  productFamilies.restore(restoredLeverage.productFamilies);
}

const githubAdapter = githubToken ? new GitHubPullRequestAdapter({ token: githubToken }) : null;
const promotion = githubAdapter ? new PullRequestPromotion({ runtime, adapter: githubAdapter }) : null;
const codingLoop = fabricExecutionClient ? new AutonomousCodingLoop({ runtime, fabricClient: fabricExecutionClient, promotion, leverage, intervalMs: Number(process.env.MAXXED_CODING_LOOP_MS ?? 2_000) }) : null;
const server = createControlPlaneServer({ runtime, adminToken, codingLoop, leverageComponents });
let saving = false;
const persist = async () => {
  if (saving) return;
  saving = true;
  try {
    await store.save(runtime.snapshot());
    await leverageStore.save({
      version: 2,
      solutionCas: solutionCas.snapshot(),
      artifactCache: artifactCache.snapshot(),
      semanticGraph: semanticGraph.snapshot(),
      trajectories: trajectoryHarvester.snapshot(),
      repairMemory: repairMemory.snapshot(),
      productFamilies: productFamilies.snapshot()
    });
  } catch (error) { console.error(JSON.stringify({ event: 'control-plane-persistence-failed', error: error.message })); }
  finally { saving = false; }
};
const timer = setInterval(() => void persist(), persistMs);
timer.unref();

server.listen(port, host, () => {
  console.log(`maxxed engineering control plane listening on http://${host}:${port}`);
  console.log(`leverage fabric active: solutions=${solutionCas.entries.size}, artifacts=${artifactCache.entries.size}, trajectories=${trajectoryHarvester.records.length}`);
  if (codingLoop) {
    codingLoop.start();
    console.log(`autonomous coding loop active at ${runtime.throughput.targetMultiplier}x baseline target`);
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

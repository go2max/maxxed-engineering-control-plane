import http from 'node:http';
import { compileCodingTask } from '../agents/coding-task.js';
import { replaceTextTransform } from '../leverage/transform-registry.js';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function bearer(req) {
  const value = req.headers.authorization ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function idempotencyKey(req) {
  const value = req.headers['idempotency-key'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function operatorCommandId(req, body) {
  const headerId = idempotencyKey(req);
  const bodyId = typeof body?.commandId === 'string' && body.commandId.trim() ? body.commandId.trim() : null;
  if (headerId && bodyId && headerId !== bodyId) throw new Error('operator command idempotency key does not match commandId');
  return headerId ?? bodyId;
}

function patchRoute(pathname) {
  const match = pathname.match(/^\/patch\/sessions\/([^/]+)\/(bundle|compose|verify|cancel)$/);
  return match ? { sessionId: decodeURIComponent(match[1]), action: match[2] } : null;
}

export function createControlPlaneServer({ runtime, adminToken, codingLoop = null, leverageComponents = null }) {
  if (!runtime) throw new Error('runtime is required');
  if (!adminToken) throw new Error('adminToken is required');
  const leverage = leverageComponents?.leverage ?? null;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/ready') {
        const readiness = runtime.readiness();
        return send(res, readiness.ready ? 200 : 503, readiness);
      }
      if (bearer(req) !== adminToken) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, runtime.status());
      if (req.method === 'GET' && url.pathname === '/tasks') return send(res, 200, { tasks: runtime.graph.list() });
      if (req.method === 'GET' && url.pathname === '/claims') return send(res, 200, { claims: runtime.claims.list() });
      if (req.method === 'GET' && url.pathname === '/models') return send(res, 200, { models: runtime.status().models });
      if (req.method === 'GET' && url.pathname === '/schedule') return send(res, 200, await runtime.schedulePreview());
      if (req.method === 'GET' && url.pathname === '/coding/status') return send(res, 200, { enabled: Boolean(codingLoop), running: Boolean(codingLoop?.running), lastTick: codingLoop?.lastTick ?? null, throughput: runtime.lastThroughputDecision });
      if (req.method === 'GET' && url.pathname === '/patch/status') return send(res, 200, leverageComponents?.patchFabric ? { sessions: leverageComponents.patchFabric.list() } : { enabled: false });
      if (req.method === 'GET' && url.pathname === '/leverage/status') return send(res, 200, leverage ? {
        ...leverage.status(), artifactCache: leverageComponents.artifactCache.entries.size,
        graphNodes: leverageComponents.semanticGraph.nodes.size, graphEdges: leverageComponents.semanticGraph.edges.size,
        transforms: leverageComponents.transforms.manifest(), repairFingerprints: leverageComponents.repairMemory.byFingerprint.size,
        productFamilies: leverageComponents.productFamilies.baselines.size,
        derivedState: leverageComponents.derivedState?.status?.() ?? null,
        codeIndexAdapters: leverageComponents.codeIndexes?.manifest?.() ?? [],
        training: leverageComponents.trajectoryHarvester.manifest(),
        workerSpecializations: leverageComponents.workerPerformance?.rows?.size ?? 0,
        flakyTests: leverageComponents.testReliability?.quarantineCandidates?.().length ?? 0,
        toolResultCache: leverageComponents.toolResultCache ? { entries: leverageComponents.toolResultCache.entries.size, ...leverageComponents.toolResultCache.stats } : null,
        executionCheckpoints: leverageComponents.executionCheckpoints?.checkpoints?.size ?? 0
      } : { enabled: false });
      if (req.method === 'GET' && url.pathname === '/leverage/training') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const acceptedOnly = url.searchParams.get('acceptedOnly') === 'true';
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') ?? 500)));
        const evalRows = leverageComponents.trajectoryHarvester.heldOutEvalRows();
        const evalSignatures = new Set(evalRows.map((row) => row.provenance.semanticSignature));
        return send(res, 200, {
          manifest: leverageComponents.trajectoryHarvester.manifest(),
          rows: leverageComponents.trajectoryHarvester.trainingRows({ acceptedOnly, excludeSignatures: evalSignatures }).slice(-limit),
          eval: evalRows.slice(-limit),
          preferences: leverageComponents.trajectoryHarvester.preferencePairs().slice(-limit)
        });
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        const afterSequence = Number(url.searchParams.get('afterSequence') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 200);
        return send(res, 200, { events: runtime.journal.list({ afterSequence, limit }) });
      }

      if (req.method === 'POST' && url.pathname === '/tasks') {
        const body = await readJson(req);
        return send(res, 201, runtime.ingest(body, { idempotencyKey: idempotencyKey(req) }));
      }
      if (req.method === 'POST' && url.pathname === '/coding/tasks') {
        const body = await readJson(req);
        const task = compileCodingTask(body);
        if (leverage) {
          const prepared = await leverage.prepareCodingTask(task, body.leverageContext ?? {});
          if (prepared.reused) return send(res, 200, prepared);
          return send(res, 201, { task: runtime.ingest(prepared.task, { idempotencyKey: idempotencyKey(req) ?? task.dedupeKey }), leverage: prepared.plan });
        }
        return send(res, 201, runtime.ingest(task, { idempotencyKey: idempotencyKey(req) ?? task.dedupeKey }));
      }
      if (req.method === 'POST' && url.pathname === '/coding/tick') {
        if (!codingLoop) return send(res, 503, { error: 'autonomous coding loop is not configured' });
        return send(res, 200, await codingLoop.tick());
      }

      if (req.method === 'POST' && url.pathname === '/patch/plan') {
        if (!leverageComponents?.shardPlanner) return send(res, 503, { error: 'patch fabric is not configured' });
        return send(res, 200, leverageComponents.shardPlanner.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/patch/sessions') {
        if (!leverageComponents?.patchFabric) return send(res, 503, { error: 'patch fabric is not configured' });
        return send(res, 201, leverageComponents.patchFabric.start(await readJson(req)));
      }
      const patch = patchRoute(url.pathname);
      if (req.method === 'POST' && patch) {
        if (!leverageComponents?.patchFabric) return send(res, 503, { error: 'patch fabric is not configured' });
        const body = await readJson(req);
        if (patch.action === 'bundle') return send(res, 200, leverageComponents.patchFabric.submit(patch.sessionId, body.bundle, { expectedGeneration: body.expectedGeneration }));
        if (patch.action === 'compose') return send(res, 200, leverageComponents.patchFabric.compose(patch.sessionId, { baseFiles: body.baseFiles ?? {} }));
        if (patch.action === 'verify') return send(res, 200, leverageComponents.patchFabric.recordParentVerification(patch.sessionId, body));
        if (patch.action === 'cancel') return send(res, 200, leverageComponents.patchFabric.cancel(patch.sessionId, body.reason));
      }

      if (req.method === 'POST' && url.pathname === '/leverage/tool-cache/peek') {
        if (!leverageComponents?.toolResultCache) return send(res, 503, { error: 'tool result cache is not configured' });
        const body = await readJson(req);
        return send(res, 200, { hit: leverageComponents.toolResultCache.peek(body.key ?? body) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/tool-cache/invalidate') {
        if (!leverageComponents?.toolResultCache) return send(res, 503, { error: 'tool result cache is not configured' });
        const body = await readJson(req);
        const removed = body.scopeFingerprint
          ? leverageComponents.toolResultCache.invalidateScope(body.scopeFingerprint)
          : leverageComponents.toolResultCache.invalidateTags(body.tags ?? []);
        return send(res, 200, { removed });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/checkpoint/save') {
        if (!leverageComponents?.executionCheckpoints) return send(res, 503, { error: 'execution checkpoint store is not configured' });
        const body = await readJson(req);
        if (!body.taskKey) return send(res, 400, { error: 'taskKey is required' });
        return send(res, 200, leverageComponents.executionCheckpoints.save(body.taskKey, body.checkpoint ?? {}, { generation: body.generation ?? 1 }));
      }
      if (req.method === 'GET' && url.pathname === '/leverage/checkpoint/resume') {
        if (!leverageComponents?.executionCheckpoints) return send(res, 503, { error: 'execution checkpoint store is not configured' });
        const taskKey = url.searchParams.get('taskKey');
        if (!taskKey) return send(res, 400, { error: 'taskKey is required' });
        const minGeneration = Number(url.searchParams.get('minGeneration') ?? 0);
        return send(res, 200, { checkpoint: leverageComponents.executionCheckpoints.resume(taskKey, { minGeneration }) });
      }

      if (req.method === 'POST' && url.pathname === '/leverage/plan') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.leverageEngine.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/index') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.sourceIndexer.index(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/index/scip') {
        if (!leverageComponents?.codeIndexes) return send(res, 503, { error: 'code index adapters are not configured' });
        return send(res, 200, await leverageComponents.codeIndexes.index('scip', await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/context') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.contextCompiler.compile(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/speculative') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.speculativePlanner.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/tests/select') {
        if (!leverageComponents?.impactTestSelector) return send(res, 503, { error: 'impact test selector is not configured' });
        const body = await readJson(req);
        const selection = leverageComponents.impactTestSelector.select(body);
        // Even when affected-only selection is confident, periodically force a full-suite
        // "challenge" run so impact-graph blind spots get caught before they compound. This is
        // the same test-selection decision point real verifiers already consult, so the
        // override is live for every real verification pass, not a separate code path.
        if (leverageComponents.challengeSuiteScheduler && selection.mode === 'targeted') {
          const scopeKey = body.scopeKey ?? body.repository ?? 'default';
          const decision = leverageComponents.challengeSuiteScheduler.shouldChallenge({ scopeKey, selectionMode: selection.mode });
          if (decision.challenge) {
            return send(res, 200, {
              ...selection,
              mode: 'full',
              tests: [...new Set(body.fullSuiteTests ?? [])].sort(),
              targetedTests: selection.tests,
              challenge: true,
              challengeReason: decision.reason,
              scopeKey
            });
          }
        }
        return send(res, 200, selection);
      }
      if (req.method === 'POST' && url.pathname === '/leverage/tests/record') {
        if (!leverageComponents?.testReliability) return send(res, 503, { error: 'test reliability ledger is not configured' });
        return send(res, 200, leverageComponents.testReliability.record(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/tests/challenge/record') {
        if (!leverageComponents?.challengeSuiteScheduler) return send(res, 503, { error: 'challenge suite scheduler is not configured' });
        return send(res, 200, leverageComponents.challengeSuiteScheduler.record(await readJson(req)));
      }
      if (req.method === 'GET' && url.pathname === '/leverage/tests/challenge/blind-spots') {
        if (!leverageComponents?.challengeSuiteScheduler) return send(res, 503, { error: 'challenge suite scheduler is not configured' });
        return send(res, 200, { blindSpots: leverageComponents.challengeSuiteScheduler.blindSpots(url.searchParams.get('scopeKey') ?? 'default') });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/training/revoke') {
        if (!leverageComponents?.trajectoryHarvester) return send(res, 503, { error: 'trajectory harvester is not configured' });
        const body = await readJson(req); if (!body.sourceRef) return send(res, 400, { error: 'sourceRef is required' });
        return send(res, 200, leverageComponents.trajectoryHarvester.revokeSource(body.sourceRef, body.reason));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/graph/nodes') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); const rows = Array.isArray(body.nodes) ? body.nodes : [body];
        return send(res, 200, { nodes: rows.map((row) => leverageComponents.semanticGraph.upsertNode(row)) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/graph/edges') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); const rows = Array.isArray(body.edges) ? body.edges : [body];
        return send(res, 200, { edges: rows.map((row) => leverageComponents.semanticGraph.addEdge(row)) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/transforms/text') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); const id = leverageComponents.transforms.register(replaceTextTransform(body));
        return send(res, 201, { id });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/transforms/execute') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); return send(res, 200, await leverageComponents.transforms.execute(body.id, body.context ?? {}));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/artifacts/put') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); return send(res, 201, leverageComponents.artifactCache.put(body.input, body.artifact, body.options ?? {}));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/artifacts/get') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); return send(res, 200, { hit: leverageComponents.artifactCache.get(body.input) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/artifact-store/put') {
        if (!leverageComponents?.artifactStore) return send(res, 503, { error: 'artifact store is not configured' });
        const body = await readJson(req); return send(res, 201, await leverageComponents.artifactStore.put(body.value, { metadata: body.metadata ?? {} }));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/artifact-store/get') {
        if (!leverageComponents?.artifactStore) return send(res, 503, { error: 'artifact store is not configured' });
        const body = await readJson(req); return send(res, 200, { hit: await leverageComponents.artifactStore.get(body.key, { parseJson: body.parseJson !== false }) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/product-families/register') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 201, leverageComponents.productFamilies.registerBaseline(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/product-families/plan') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.productFamilies.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/register') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.registerCapability(await readJson(req)));
      }
      if (req.method === 'GET' && url.pathname === '/leverage/capabilities/find') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        const key = url.searchParams.get('key') ?? undefined;
        const tags = url.searchParams.getAll('tag');
        return send(res, 200, { match: leverageComponents.capabilityGraph.findCanonicalCapability({ key, tags }) });
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/implementations') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.registerImplementation(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/link-family') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.linkFamily(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/link-instance') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.linkInstance(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/link-test') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.linkTest(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/capabilities/link-channel') {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        return send(res, 201, leverageComponents.capabilityGraph.linkChannel(await readJson(req)));
      }
      if (req.method === 'GET' && url.pathname.match(/^\/leverage\/capabilities\/[^/]+\/impact$/)) {
        if (!leverageComponents?.capabilityGraph) return send(res, 503, { error: 'capability graph is not configured' });
        const key = decodeURIComponent(url.pathname.split('/')[3]);
        return send(res, 200, leverageComponents.capabilityGraph.impactOf(key));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/abstraction-mining/run') {
        if (!leverageComponents?.abstractionMiner) return send(res, 503, { error: 'abstraction miner is not configured' });
        const body = await readJson(req);
        return send(res, 200, leverageComponents.abstractionMiner(body));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/maintenance/plan') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.maintenancePlanner.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/bottleneck') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.bottleneckOptimizer.analyze(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/replay') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const body = await readJson(req); return send(res, 200, leverageComponents.replayProjector.replay(body.events ?? runtime.journal.list({ limit: 10000 }), body.seed ?? {}));
      }
      if (req.method === 'POST' && url.pathname === '/models/shadow-compare') {
        const body = await readJson(req); return send(res, 200, runtime.modelEvals.shadowComparison(body));
      }

      if (req.method === 'POST' && url.pathname === '/dispatch') return send(res, 200, { dispatches: await runtime.dispatch() });
      if (req.method === 'POST' && url.pathname === '/results') {
        const body = await readJson(req);
        return send(res, 200, runtime.complete(body, { idempotencyKey: idempotencyKey(req) }));
      }
      if (req.method === 'POST' && url.pathname === '/operator/command') {
        const body = await readJson(req);
        const commandId = operatorCommandId(req, body);
        if (!commandId) return send(res, 400, { error: 'operator command idempotency-key or commandId is required' });
        return send(res, 200, runtime.operatorCommand(body, { commandId }));
      }
      if (req.method === 'POST' && url.pathname === '/models/warmup') return send(res, 200, { models: await runtime.warmupModels() });
      if (req.method === 'POST' && url.pathname === '/models/execute') return send(res, 200, await runtime.executeModel(await readJson(req)));

      if (req.method === 'POST' && url.pathname === '/operator/pause') return send(res, 200, runtime.operatorCommand({ action: 'pause-dispatch' }, { commandId: idempotencyKey(req) ?? `legacy-pause-${Date.now()}` }));
      if (req.method === 'POST' && url.pathname === '/operator/resume') return send(res, 200, runtime.operatorCommand({ action: 'resume-dispatch' }, { commandId: idempotencyKey(req) ?? `legacy-resume-${Date.now()}` }));
      if (req.method === 'POST' && url.pathname === '/operator/recover-expired') return send(res, 200, runtime.operatorCommand({ action: 'recover-expired' }, { commandId: idempotencyKey(req) ?? `legacy-recover-${Date.now()}` }));

      send(res, 404, { error: 'not found' });
    } catch (error) {
      send(res, 400, { error: error.message, attempts: error.attempts ?? undefined, conflicts: error.conflicts ?? undefined });
    }
  });
  return server;
}

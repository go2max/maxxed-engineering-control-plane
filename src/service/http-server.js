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
      if (req.method === 'GET' && url.pathname === '/coding/status') return send(res, 200, { enabled: Boolean(codingLoop), running: Boolean(codingLoop?.running), lastTick: codingLoop?.lastTick ?? null, throughput: runtime.lastThroughputDecision });
      if (req.method === 'GET' && url.pathname === '/leverage/status') return send(res, 200, leverage ? {
        ...leverage.status(), artifactCache: leverageComponents.artifactCache.entries.size,
        graphNodes: leverageComponents.semanticGraph.nodes.size, graphEdges: leverageComponents.semanticGraph.edges.size,
        transforms: leverageComponents.transforms.manifest(), repairFingerprints: leverageComponents.repairMemory.byFingerprint.size,
        productFamilies: leverageComponents.productFamilies.baselines.size
      } : { enabled: false });
      if (req.method === 'GET' && url.pathname === '/leverage/training') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        const acceptedOnly = url.searchParams.get('acceptedOnly') === 'true';
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') ?? 500)));
        return send(res, 200, { rows: leverageComponents.trajectoryHarvester.trainingRows({ acceptedOnly }).slice(-limit), preferences: leverageComponents.trajectoryHarvester.preferencePairs().slice(-limit) });
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
          const prepared = leverage.prepareCodingTask(task, body.leverageContext ?? {});
          if (prepared.reused) return send(res, 200, prepared);
          return send(res, 201, { task: runtime.ingest(prepared.task, { idempotencyKey: idempotencyKey(req) ?? task.dedupeKey }), leverage: prepared.plan });
        }
        return send(res, 201, runtime.ingest(task, { idempotencyKey: idempotencyKey(req) ?? task.dedupeKey }));
      }
      if (req.method === 'POST' && url.pathname === '/coding/tick') {
        if (!codingLoop) return send(res, 503, { error: 'autonomous coding loop is not configured' });
        return send(res, 200, await codingLoop.tick());
      }

      if (req.method === 'POST' && url.pathname === '/leverage/plan') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.leverageEngine.plan(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/index') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.sourceIndexer.index(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/context') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.contextCompiler.compile(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/speculative') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.speculativePlanner.plan(await readJson(req)));
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
      if (req.method === 'POST' && url.pathname === '/leverage/product-families/register') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 201, leverageComponents.productFamilies.registerBaseline(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/leverage/product-families/plan') {
        if (!leverageComponents) return send(res, 503, { error: 'leverage fabric is not configured' });
        return send(res, 200, leverageComponents.productFamilies.plan(await readJson(req)));
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
      send(res, 400, { error: error.message, attempts: error.attempts ?? undefined });
    }
  });
  return server;
}

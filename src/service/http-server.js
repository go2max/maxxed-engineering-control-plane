import http from 'node:http';

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

export function createControlPlaneServer({ runtime, adminToken }) {
  if (!runtime) throw new Error('runtime is required');
  if (!adminToken) throw new Error('adminToken is required');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (bearer(req) !== adminToken) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, runtime.status());
      if (req.method === 'GET' && url.pathname === '/tasks') return send(res, 200, { tasks: runtime.graph.list() });
      if (req.method === 'GET' && url.pathname === '/claims') return send(res, 200, { claims: runtime.claims.list() });

      if (req.method === 'POST' && url.pathname === '/tasks') return send(res, 201, runtime.ingest(await readJson(req)));
      if (req.method === 'POST' && url.pathname === '/dispatch') return send(res, 200, { dispatches: await runtime.dispatch() });
      if (req.method === 'POST' && url.pathname === '/results') return send(res, 200, runtime.complete(await readJson(req)));
      if (req.method === 'POST' && url.pathname === '/operator/pause') return send(res, 200, runtime.pause());
      if (req.method === 'POST' && url.pathname === '/operator/resume') return send(res, 200, runtime.resume());
      if (req.method === 'POST' && url.pathname === '/operator/recover-expired') return send(res, 200, { expired: runtime.recoverExpired() });

      send(res, 404, { error: 'not found' });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
  return server;
}

function normalize(url) { return String(url ?? 'http://127.0.0.1:7788').replace(/\/$/, ''); }

async function parse(response) {
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error ?? `fabric request failed: ${response.status}`);
  return body;
}

export class FabricExecutionClient {
  constructor({ baseUrl = 'http://127.0.0.1:7788', adminToken, fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
    if (!adminToken) throw new Error('fabric admin token is required');
    this.baseUrl = normalize(baseUrl); this.adminToken = adminToken; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }

  async enqueue(task) { return this.#request('/tasks', { method: 'POST', body: JSON.stringify(task) }); }
  async fleet() { return this.#request('/fleet', { method: 'GET' }); }

  async #request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await parse(await this.fetch(`${this.baseUrl}${path}`, {
        ...init, signal: controller.signal,
        headers: { authorization: `Bearer ${this.adminToken}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) }
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`fabric request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally { clearTimeout(timer); }
  }
}

function validationChecks(result) {
  if (!Array.isArray(result?.validation)) return {};
  return Object.fromEntries(result.validation.map((row, index) => [String(row.name ?? `step-${index + 1}`), {
    ok: Boolean(row.ok),
    ...(row.ok ? {} : { class: 'TEST_FAILURE' }),
    exitCode: row.exitCode ?? null,
    timedOut: Boolean(row.timedOut),
    stdout: row.stdout ?? '',
    stderr: row.stderr ?? '',
    durationMs: row.durationMs ?? null
  }]));
}

export function evidenceFromFabricResult(task, fabricTask) {
  const result = fabricTask?.result ?? fabricTask?.failure ?? {};
  const required = task?.metadata?.acceptance?.requiredChecks ?? [];
  const checks = { ...validationChecks(result), ...(result.checks ?? {}) };
  if (fabricTask?.state === 'FAILED') {
    for (const name of required) {
      if (!(name in checks)) checks[name] = { ok: false, class: result.failureClass === 'EXECUTION_FAILURE' ? 'BUILD_FAILURE' : 'TEST_FAILURE', detail: result.error ?? 'worker execution failed' };
    }
  }
  return {
    producerId: fabricTask?.preferredWorkerId ?? 'fabric-worker',
    verifierId: null,
    checks,
    artifacts: {
      branchName: result.branchName ?? null,
      commitSha: result.commitSha ?? null,
      pushed: Boolean(result.pushed),
      diff: result.diff ?? '',
      summary: result.summary ?? '',
      durationMs: result.durationMs ?? null,
      patchBundle: result.patchBundle ? structuredClone(result.patchBundle) : null,
      validation: Array.isArray(result.validation) ? structuredClone(result.validation) : null,
      exactRef: result.exactRef ?? null,
      repository: result.repository ?? task?.repository ?? null
    },
    execution: Array.isArray(result.validation) ? structuredClone(result.validation) : (result.evidence ?? []),
    taskKey: task.key
  };
}

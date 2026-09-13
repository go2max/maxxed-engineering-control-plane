function repoParts(repository) {
  const [owner, repo, ...rest] = String(repository ?? '').split('/');
  if (!owner || !repo || rest.length) throw new Error('repository must be owner/name');
  return { owner, repo };
}

async function parse(response) {
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.message ?? `GitHub request failed: ${response.status}`);
  return body;
}

export class GitHubPullRequestAdapter {
  constructor({ token, fetchImpl = fetch, apiBase = 'https://api.github.com', timeoutMs = 10_000 } = {}) {
    if (!token) throw new Error('GitHub token is required');
    this.token = token; this.fetch = fetchImpl; this.apiBase = apiBase.replace(/\/$/, ''); this.timeoutMs = timeoutMs;
  }

  async ensurePullRequest({ repository, headBranch, baseBranch = 'main', title, body = '' } = {}) {
    if (!headBranch) throw new Error('headBranch is required');
    const { owner, repo } = repoParts(repository);
    const existing = await this.#request(`/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${headBranch}`)}&base=${encodeURIComponent(baseBranch)}`, { method: 'GET' });
    if (Array.isArray(existing) && existing[0]) return { created: false, pullRequest: existing[0] };
    const pullRequest = await this.#request(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST', body: JSON.stringify({ title: title || `Maxxed autonomous change: ${headBranch}`, head: headBranch, base: baseBranch, body })
    });
    return { created: true, pullRequest };
  }

  async #request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await parse(await this.fetch(`${this.apiBase}${path}`, {
        ...init, signal: controller.signal,
        headers: {
          accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`,
          'x-github-api-version': '2022-11-28', ...(init.body ? { 'content-type': 'application/json' } : {})
        }
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`GitHub request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally { clearTimeout(timer); }
  }
}

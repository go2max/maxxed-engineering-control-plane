import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneRuntime } from '../src/service/control-plane-runtime.js';
import { compileCodingTask } from '../src/agents/coding-task.js';
import { PullRequestPromotion } from '../src/service/pr-promotion.js';
import { GitHubPullRequestAdapter } from '../src/service/github-pr-adapter.js';

test('accepted pushed coding branch is promoted exactly once', async () => {
  const runtime = new ControlPlaneRuntime();
  const task = compileCodingTask({ key: 't1', repository: 'Maxxed-Technical-Systems/demo', repoPath: '/repo', objective: 'fix bug', testCommands: [{ name: 'unit', command: 'npm', args: ['test'] }] });
  runtime.ingest(task);
  runtime.graph.setState('t1', 'ACCEPTED', {
    evidenceBundle: { payload: { evidence: { artifacts: { pushed: true, branchName: 'maxxed/agent/t1-g1', commitSha: 'abc123' } } } }
  });
  let calls = 0;
  const adapter = { ensurePullRequest: async () => { calls += 1; return { created: true, pullRequest: { number: 7, html_url: 'https://github.invalid/pr/7' } }; } };
  const promotion = new PullRequestPromotion({ runtime, adapter });
  const first = await promotion.sync(1000);
  const second = await promotion.sync(1001);
  assert.equal(calls, 1);
  assert.equal(first[0].pullRequestNumber, 7);
  assert.equal(second[0].pullRequestNumber, 7);
});

test('GitHub PR adapter reuses existing open PR', async () => {
  let requests = 0;
  const adapter = new GitHubPullRequestAdapter({
    token: 'x',
    fetchImpl: async (url, init) => {
      requests += 1;
      assert.equal(init.method, 'GET');
      assert.match(url, /head=Maxxed-Technical-Systems%3Amaxxed%2Fagent%2Ft1-g1/);
      return { ok: true, async json() { return [{ number: 9, html_url: 'https://github.invalid/pr/9' }]; } };
    }
  });
  const result = await adapter.ensurePullRequest({ repository: 'Maxxed-Technical-Systems/demo', headBranch: 'maxxed/agent/t1-g1', baseBranch: 'main', title: 'test' });
  assert.equal(requests, 1);
  assert.equal(result.created, false);
  assert.equal(result.pullRequest.number, 9);
});

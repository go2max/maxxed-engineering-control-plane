import { TaskState } from '../core/task-graph.js';

function acceptedArtifacts(task) {
  const last = [...(task.lineage ?? [])].reverse().find((entry) => entry.state === TaskState.ACCEPTED && entry.evidence?.evidenceBundle?.payload?.evidence?.artifacts);
  return last?.evidence?.evidenceBundle?.payload?.evidence?.artifacts ?? null;
}

export class PullRequestPromotion {
  constructor({ runtime, adapter } = {}) {
    if (!runtime || !adapter) throw new Error('runtime and adapter are required');
    this.runtime = runtime; this.adapter = adapter;
  }

  async sync(now = Date.now()) {
    const promoted = [];
    for (const task of this.runtime.graph.list()) {
      if (task.state !== TaskState.ACCEPTED || task.metadata?.execution?.kind !== 'coding-agent') continue;
      if (task.metadata?.repairOf) continue;
      const artifacts = acceptedArtifacts(task);
      if (!artifacts?.pushed || !artifacts.branchName || !artifacts.commitSha) continue;
      const promotionKey = `pr-promotion:${task.repository}:${artifacts.branchName}:${artifacts.commitSha}`;
      const result = await this.runtime.journal.once(promotionKey, { taskKey: task.key, commitSha: artifacts.commitSha }, async () => {
        const pr = await this.adapter.ensurePullRequest({
          repository: task.repository,
          headBranch: artifacts.branchName,
          baseBranch: task.metadata.execution.baseBranch ?? 'main',
          title: `Maxxed: ${task.objective || task.key}`,
          body: `Autonomous coding task: ${task.key}\n\nAccepted commit: ${artifacts.commitSha}\n\nThis branch was produced under a fenced compute-fabric lease and passed the task acceptance contract. Merge remains governed by repository policy.`
        });
        this.runtime.journal.append('coding.pr.promoted', { taskKey: task.key, repository: task.repository, branchName: artifacts.branchName, commitSha: artifacts.commitSha, created: pr.created, number: pr.pullRequest?.number ?? null }, now);
        return pr;
      });
      promoted.push({ taskKey: task.key, branchName: artifacts.branchName, commitSha: artifacts.commitSha, created: result.created, pullRequestNumber: result.pullRequest?.number ?? null, url: result.pullRequest?.html_url ?? null });
    }
    return promoted;
  }
}

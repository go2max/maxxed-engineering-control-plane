import { digest } from './solution-cas.js';

export class MaintenancePlanner {
  plan({ changeId, repositories = [], transformId, verification = [], batchSize = 25, priority = 0 } = {}) {
    if (!changeId || !transformId) throw new Error('changeId and transformId are required');
    const repos = [...new Set(repositories)].sort();
    const batches = [];
    for (let i = 0; i < repos.length; i += Math.max(1, Number(batchSize))) {
      const slice = repos.slice(i, i + Math.max(1, Number(batchSize)));
      batches.push({
        id: `${changeId}:batch:${Math.floor(i / Math.max(1, Number(batchSize))) + 1}`,
        repositories: slice,
        transformId,
        verification: structuredClone(verification),
        priority: Number(priority),
        dedupeKey: digest({ changeId, transformId, repositories: slice, verification })
      });
    }
    return { changeId, transformId, repositoryCount: repos.length, batchCount: batches.length, batches };
  }
}

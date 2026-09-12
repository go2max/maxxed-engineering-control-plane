# PR 011 — Dynamic lanes and backpressure

Adds adaptive scheduler capacity based on live worker slots and CPU pressure, excludes degraded/offline/saturated hosts, supports per-repository WIP overrides, and emits explicit backpressure reasons when work cannot dispatch.

Backpressure classes include global lane capacity, repository WIP limit, and no eligible worker. Dispatch explanations now include adaptive lane and repository lane limits.

Portfolio Scheduler and Dynamic Lanes advances from 38% to 55%.

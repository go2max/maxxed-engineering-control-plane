# PR 002 — Task graph runtime

Adds the first executable control-plane core runtime: normalized tasks, dependency edges, dedupe enforcement, dependency-cycle rejection, blocker explanations, executable-frontier computation, stable task lineage, and dependency unlock counting.

The runtime intentionally uses Node.js 22 built-ins only. This slice advances the Engineering Control Plane Core category from 18% to 28%; other category percentages remain unchanged.

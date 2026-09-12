# PR 003 — Portfolio scheduler runtime

Adds deterministic portfolio scheduling over the executable task frontier. The scheduler combines explicit priority, dependency-unlock leverage, starvation protection, risk/failure penalties, repository lane caps, a global lane cap, and heterogeneous worker capability/capacity matching.

Every dispatch includes an explanation record so Maxxed Admin can show why a task was selected and why a worker was chosen.

This slice advances Portfolio Scheduler and Dynamic Lanes from 12% to 30%.

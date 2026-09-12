# PR 006 — Global claim authority

Adds authoritative control-plane claims for tasks and mutable resource scopes. Claims bind task, owner, scopes, expiry and fencing generation; conflicting scopes cannot be held concurrently. Expiry releases locks, renewal requires the current token, and fencing invalidates stale writers before reassignment.

This slice advances Engineering Control Plane Core from 28% to 40%.

# Validation history

All tracked implementation categories reached 100% and were retired only after two qualifying validation passes on the approved Maxxed-Technical-Systems organization-scoped local self-hosted runner path.

## Runner policy

- GitHub-hosted runners: forbidden.
- Repository-scoped self-hosted runners: forbidden.
- Qualifying runner contract: `self-hosted` + `maxxed-linux` on the Maxxed-Technical-Systems organization runner pool.
- Observed runner identity during validation: `Maxxed-Technical-Systems-linux`.

## Local Compute Fabric

Validated source: `Maxxed-Technical-Systems/maxxed-local-compute-fabric@cf96fc43cc878f46e843b1e6b17364588c922652`.

- Pass 1: workflow run `34736046683`, attempt 1, job `103667557748` — success.
- Pass 2: workflow run `34736046683`, attempt 2, job `103671513841` — success.

The earlier failed run `34735962038` is retained as non-qualifying evidence; it correctly failed because Node was unavailable on the runner before the local Node 22 bootstrap was added.

## Engineering control-plane categories

Validated source: `go2max/maxxed-engineering-control-plane@264b5b36753968b8e8032c28d00150136bb1e526`.

The canonical `npm run validate` suite covered Engineering Control Plane Core, Portfolio Scheduler and Dynamic Lanes, Verifier and Repair Fabric, Local AI / Model Router, and SaaS / Web Product Factory.

- Pass 1: workflow run `34737615059`, attempt 1, job `103671675705` — success.
- Pass 2: workflow run `34737615059`, attempt 2, job `103671938249` — success.

The org-owned validation workflow cloned the exact public commit in detached-HEAD mode and verified `git rev-parse HEAD` before running the suite.

## Maxxed Admin Operator Integration

Validated source: `go2max/Maxxed-Tech-Site@1d9208268eabbf38f698711c96747d31a6c123b6`.

Because Maxxed-Tech-Site is private and personal-scoped, its four self-contained operator-integration files were copied temporarily into the private organization validation repo. Before tests ran, the workflow verified each copied file with `git hash-object` against the source Git blob SHA:

- `engineering-control-plane-adapter.js`: `0e60ff7b66060681fdf2d91986dda6c75c328085`
- `engineering-operator-service.js`: `cd7bd7678620f69f18b48d948ba8999bffb769f1`
- `engineering-control-plane-adapter.test.mjs`: `21303d84c8c24450c482520d4085c24db7eda57e`
- `engineering-operator-service.test.mjs`: `3de64270ba3758ec2be400da28978f02c578a12c`

- Pass 1: workflow run `34737719390`, attempt 1, job `103671974471` — success.
- Pass 2: workflow run `34737719390`, attempt 2, job `103672157938` — success.

The temporary Admin validation snapshot is removed after completion so the control-plane and Maxxed-Tech-Site remain the authoritative sources.

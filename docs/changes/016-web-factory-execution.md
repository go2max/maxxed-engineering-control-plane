# PR 016 — SaaS / Web factory execution semantics

Adds concrete stage evidence contracts and semantic job recipes for specification, implementation, unit/API testing, browser acceptance, accessibility, security, staging deployment, visual verification and final acceptance.

Failed evidence now produces a typed repair handoff instead of silently advancing. Accepted runs can emit a production-verification job only when the deployed commit SHA matches the exact accepted commit.

SaaS / Web Product Factory advances from 24% to 45%.

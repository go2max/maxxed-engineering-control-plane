# PR 004 — Verifier and repair runtime

Adds executable verification and bounded repair control. The verifier independently evaluates required evidence and distinguishes ordinary repairable failures from security, policy, or uncertain external-state failures that must escalate.

The repair controller enforces maximum attempts and a repeated-failure circuit breaker so identical failures cannot loop indefinitely.

This slice advances Verifier and Repair Fabric from 10% to 30%.

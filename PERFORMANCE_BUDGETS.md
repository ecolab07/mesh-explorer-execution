# PERFORMANCE_BUDGETS

## Scope

Phase 18 introduces a **nightly perf guardrail** workflow. These checks are intentionally non-blocking for PR CI to avoid flakiness.

## Nightly metrics

`pnpm bench:nightly` records:

1. `txPerSecPersistent` from single-writer submit baseline (`scripts/bench/perf-1.mjs`, persistent backend).
2. `replicaCatchupMs` for notes replica catch-up after N writes (`scripts/bench/replica-catchup.mjs`).
3. `snapshotMaintenanceMs` for startup snapshot maintenance (`scripts/bench/snapshot-maintenance.mjs`).

## Thresholds (conservative)

- `txPerSecPersistent >= 180`
- `replicaCatchupMs <= 2500`
- `snapshotMaintenanceMs <= 2200`

These thresholds are enforced only when `--fail-on-regression` is passed (used by nightly workflow).

## CI policy

- PR/main CI: no blocking perf budget assertions.
- Nightly scheduled CI: run with regression failure enabled and store artifacts:
  - `artifacts/perf-nightly/nightly-perf-results.json`
  - `artifacts/perf-nightly/nightly-perf-summary.md`

## Local run

```bash
pnpm bench:nightly
pnpm bench:nightly --fail-on-regression
```

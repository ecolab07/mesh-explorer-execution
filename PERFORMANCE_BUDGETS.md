# PERFORMANCE_BUDGETS

## 1) Scope

Perf-1 introduces informative-only benchmarks for local Mesh backends. The benchmark output is intended for trend tracking and release-note comparison, not for CI enforcement. No thresholds are asserted and no release gate is blocked by these measurements.

## 2) Measured scenarios

`scripts/bench/perf-1.mjs` measures three deterministic scenarios on each backend (`inmemory`, `persistent`, `indexeddb`):

1. **append**: append `N` deterministic transactions.
2. **replay**: cold restart against the same store and replay to current head.
3. **projection rebuild**: rebuild principal projection from cursor `0`.

The dataset size is controlled by `MESH_BENCH_N` (default: `1000`).

## 3) Indicative budgets

Budgets for Perf-1 are intentionally **non-blocking**:

- Use results as a baseline and watch for significant regressions over time.
- Compare runs on similar hardware/Node versions before drawing conclusions.
- Prefer relative changes (e.g. `% delta`) rather than absolute times.

If teams choose internal targets, record them in release notes with machine context and keep them advisory.

## 4) Known performance risks

Current known risks (already documented elsewhere) include:

- Some local EventStore paths rely on repeated filtering/scans and can drift toward O(N²)-like behavior on large histories.
- Projection snapshots currently retain `txIds`, so snapshot payload growth is roughly linear with transaction count.
- IndexedDB backend remains experimental/beta and may vary significantly across environments.

See `KNOWN_LIMITATIONS.md` for the source-of-truth wording.

## 5) How to run

```bash
pnpm bench:perf-1
```

Optional parameters:

```bash
MESH_BENCH_N=200 pnpm bench:perf-1
MESH_BENCH_BACKENDS=inmemory,persistent pnpm bench:perf-1
```

The script prints one JSON document to stdout for manual archival in release notes.

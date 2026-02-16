# Release Workflow (Phase 18 Hardening v1)

This repository uses **phase-aligned semver** (`0.<phase>.<patch>`) and keeps Mesh public API v1 stable unless explicitly declared.

## Release targets

- Root package (`mesh-explorer-execution`) for repository-wide version tracking.
- Workspace packages under `packages/*`.
- Phase 17 app skeleton deliverables (`apps/mesh-notes-server`, `apps/mesh-notes-replica`, `apps/mesh-app`) versioned in lockstep for reproducible docs/examples.

## Local release commands

> Example target version: `0.18.0`

1. Run blocking quality gates:

```bash
pnpm -r build
pnpm check:api-contract
pnpm test
pnpm --filter @mesh/conformance-tests check:critical
pnpm check:packaging
pnpm --filter @mesh/conformance-tests check:artifacts-clean
```

2. Bump versions (dry run then apply):

```bash
pnpm release:bump 0.18.0 --dry-run
pnpm release:bump 0.18.0
```

3. Update changelog entry:

```bash
pnpm release:changelog 0.18.0 --date 2026-02-16
```

4. Build release artifacts (`.tgz` for `packages/*`):

```bash
pnpm release:artifacts 0.18.0
```

5. Create release tag:

```bash
pnpm release:tag 0.18.0
```

6. Push branch and tag:

```bash
git push origin <branch>
git push origin v0.18.0
```

## CI compatibility

- PR/main CI stays blocking on conformance + API contract checks.
- Nightly perf budgets run on schedule only (see `.github/workflows/perf-nightly.yml`).

## Next

### Phase 19 — Observability Runtime v2

- runtime metrics exposable (admin-safe)
- replica lag metrics
- compaction stats
- saturation counters
- support bundle enrichi

### Phase 20 — Multi-Environment Readiness

- container minimal deployment
- prod config (quotas, limits, policies)
- cold-start realistic scenarios
- restart tests in simulated environment

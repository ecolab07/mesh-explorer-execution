# Migrations & Schema Bump Readiness (v1)

This repository currently runs on **schema v1** for runtime-local/eventstore/snapshot layouts.

## What is a schema bump?

A schema bump is any backward-incompatible storage change, including:

- eventstore on-disk layout changes (`eventstore/events.json` or notes server eventstore file)
- snapshot envelope/layout changes (`snapshots/snapshots.json`)
- metadata changes required to replay/resolve cursors safely

## Runtime detection model

- `pnpm migrate:check --rootDir <path>` inspects storage files and reports detected schema metadata.
- Current v1 files may be **legacy unversioned**; the checker treats known legacy layout as v1-compatible.
- Unknown or mismatched schema reports return a non-zero exit code for fail-fast handling.

## Safe fallback behavior

Normative behavior for unknown/mismatched schemas:

1. **Fail fast before writes** (read-only/maintenance mode).
2. Take backup of runtime root.
3. Run explicit offline migration tool for the target version (future phase).
4. Restart with migrated storage.

No auto-migration is performed in Phase 18.

## Harness command

```bash
pnpm migrate:check --rootDir .mesh-notes-data
```

The command prints actionable JSON status for eventstore/snapshot files.

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

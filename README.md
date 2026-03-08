# mesh-explorer-execution

Phase 9 bootstrap scaffold for local execution conformance.

## Runtime toolchain (canonical)

- Node: `20.11.1` (see `.nvmrc` and `package.json#engines`)
- pnpm: `9.15.4` via Corepack (`packageManager`)

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm --version
```

## CI-aligned conformance validation path

```bash
pnpm install --frozen-lockfile --filter @mesh/conformance-tests...
pnpm ci:conformance
```

Equivalent expanded form:

```bash
pnpm ci:conformance:build
pnpm ci:conformance:test
```

This is the same scoped build/test contract used by conformance CI workflows.

> Windows note: Rollup 4 loads a platform-native optional package (`@rollup/rollup-win32-x64-msvc`).
> This repo pins it in root `optionalDependencies` so `pnpm install` materializes it on Windows for webapp dev.

## Chaos profiles (smoke vs soak)

Chaos/passive-replication suites read these env vars:

- `MESH_CHAOS_SEEDS` (CSV list, default: `1,2,3,4,5`)
- `MESH_CHAOS_STEPS` (default: `200`)
- `MESH_CHAOS_BACKEND` (`inmemory` | `persistent` | `both`, default: `inmemory`)

CI uses smoke values on PR and soak values on nightly.

Spec-first references are in `specs/Mesh_Execution_Compiled_v_1.md`.

## Audits

- [Phase 17 post-merge audit](./PHASE_17_AUDIT_POST_MERGE.md)

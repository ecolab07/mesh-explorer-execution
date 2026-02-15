# mesh-explorer-execution

Phase 9 bootstrap scaffold for local execution conformance.

## Run

```bash
pnpm install
pnpm -r build
pnpm test
```

## Chaos profiles (smoke vs soak)

Chaos/passive-replication suites read these env vars:

- `MESH_CHAOS_SEEDS` (CSV list, default: `1,2,3,4,5`)
- `MESH_CHAOS_STEPS` (default: `200`)
- `MESH_CHAOS_BACKEND` (`inmemory` | `persistent` | `both`, default: `inmemory`)

CI uses smoke values on PR and soak values on nightly.

Spec-first references are in `specs/Mesh_Execution_Compiled_v_1.md`.

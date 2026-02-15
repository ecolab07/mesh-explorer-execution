# Mesh Explorer Operational Guarantees

This note captures runtime-local + CLI operational contracts relied on by tooling and automation.

## Runtime contracts (`@mesh/runtime-local`)

### `runtime.start()` performs startup maintenance

- `start()` is responsible for startup/rebuild behavior.
- When `snapshotPolicy` is configured, `start()` **may** load snapshots and create/update snapshots as maintenance.
- Snapshot policy gates are evaluated during `start()` (for example `minTx`, `intervalMs`).
- Maintenance decisions do not change command semantics; they only affect startup performance.

### `runtime.read()` is pure

- `read()` returns a deterministic `{ head, view }` for current committed state.
- `read()` does **not** run compaction.
- `read()` does **not** create or update snapshots.
- `read()` must remain side-effect free with respect to storage maintenance files.

### `head.tx` semantics

- `head.tx` is an opaque cursor/etag-like token.
- Consumers must treat `head.tx` as equality-only (`===`/`!==`) for freshness checks.
- Consumers must not parse or infer ordering from token format.

## CLI contracts (`@mesh/cli`)

### Output channels

- Successful machine results are emitted as JSON on `stdout`.
- Human-readable failures are emitted on `stderr`.
- Callers should parse `stdout` only on success (`exit code 0` or command-specific success paths).

### Exit code mapping

`mesh write` has stable process exit semantics:

- `0`: command committed (`outcome.status === "committed"`).
- `2`: command rejected by runtime/kernel validation (`outcome.status === "rejected"`).
- `1`: CLI/runtime errors (argument errors, malformed JSON, startup/runtime exceptions).

Other commands (`read`, `status`, `help`, `version`) return:

- `0` on success.
- `1` on CLI/runtime errors.

## Operational intent

These guarantees are intentionally narrow:

- They support scriptability and automation safety.
- They avoid hidden state mutations during read paths.
- They keep restart behavior predictable while allowing startup maintenance.

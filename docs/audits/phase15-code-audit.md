# Mesh Explorer Code Audit — Phase 15 (runtime-local + CLI)

Scope reviewed:

- Runtime/local/CLI packages: `runtime-local`, `cli`, `eventstore-local`, `projection-minimal`, `snapshot-minimal`, `kernel-minimal`, `shared`.
- Specs/docs in repo: `specs/Mesh_Execution_Compiled_v_1.md`, `docs/operational-guarantees.md`, package READMEs/tests.

Method:

- Static audit only (no implementation changes in this report).
- Cross-check implementation against normative spec clauses and operational contracts.

---

## A) Correctness & Conformance to Specs

### Finding A1 — Idempotency hash is not canonicalized as required
- **Severity:** Major
- **Evidence:** Kernel computes `payloadHash` via direct `JSON.stringify({ payload, requireBaseRevision })` and carries an explicit TODO to replace with canonical hasher. This is order-sensitive and not semantically canonical. (`packages/kernel-minimal/src/KernelMinimalImpl.ts`) 
- **Spec reference:** Spec requires stable deterministic hashing with non-deterministic normalization and semantic consistency (`stable collection ordering`, `exclude/normalize nondeterministic fields`). (`specs/Mesh_Execution_Compiled_v_1.md`)
- **Risk:** Same logical payload with different key ordering can produce different hashes and trigger false idempotency conflicts.
- **Recommended action:** **Fix** implementation to use a canonical normalizer/hasher and add conformance tests for object-key-order invariance.

### Finding A2 — Event payload/eventId conformance is looser than normative choice
- **Severity:** Major
- **Evidence:** Kernel builds tx bundle as a single graph event from `command.payload` and does not require `payload.eventId`; event IDs are always store-generated (`${txId}-g-${n}`). (`packages/kernel-minimal/src/KernelMinimalImpl.ts`, `packages/eventstore-local/src/FileBackedLocalEventStore.ts`)
- **Spec reference:** Normative minimal choice says kernel MUST require eventId in payload for conformance determinism. (`specs/Mesh_Execution_Compiled_v_1.md`)
- **Risk:** Divergence from conformance profile for deterministic payload-level identities.
- **Recommended action:** **Fix or document phase delta**. Either enforce `payload.eventId` in kernel validation or explicitly document this as an intentional temporary deviation.

### Finding A3 — IndexedDB local backend contract is unimplemented
- **Severity:** Minor
- **Evidence:** `IndexedDbLocalEventStore.ts` is TODO-only. (`packages/eventstore-local/src/IndexedDbLocalEventStore.ts`)
- **Spec reference:** Execution spec defines IndexedDB local backend behavior/algorithms as normative for that backend profile. (`specs/Mesh_Execution_Compiled_v_1.md`)
- **Risk:** Consumers expecting the IndexedDB backend from spec cannot rely on package parity.
- **Recommended action:** **Improve doc + backlog**. Clarify phase status in package docs and track implementation milestone.

---

## B) Potential Bugs, Anti-patterns, and Fragile Areas

### Finding B1 — `readPrincipalTxRange` has mixed cursor semantics fallback path
- **Severity:** Major
- **Evidence:** Fast path treats cursor as principal-visible ordinal (`slice(fromPrincipalCursorExclusive, ...)`), but fallback compares against global `txIndex` (`tx.txIndex > fromPrincipalCursorExclusive`). (`packages/eventstore-local/src/FileBackedLocalEventStore.ts`, `packages/eventstore-local/src/InMemoryLocalEventStore.ts`)
- **Risk:** Under sparse visibility/compaction/reindex scenarios, cursor interpretation can drift, causing skipped/duplicated tx reads.
- **Recommended action:** **Fix** to use one cursor domain consistently (principal ordinal or global txIndex) and codify invariant tests.

### Finding B2 — Projection/eventstore hot paths are O(N²)-leaning
- **Severity:** Major
- **Evidence:** For each tx index entry, code repeatedly filters full `meta`/`graph` arrays by `txId` in range/head methods. (`packages/eventstore-local/src/FileBackedLocalEventStore.ts`, `packages/eventstore-local/src/InMemoryLocalEventStore.ts`)
- **Risk:** Large histories will degrade read/replay latency significantly.
- **Recommended action:** **Fix/optimize** by maintaining txId→events index or pre-grouped structures and avoid repeated full scans.

### Finding B3 — Snapshot payload retains full `txIds` list (unbounded growth)
- **Severity:** Minor
- **Evidence:** Projection snapshot stores full `txIds` and extends it every rebuild/incremental update. (`packages/projection-minimal/src/index.ts`)
- **Risk:** Memory/storage grows linearly with history and increases snapshot I/O costs.
- **Recommended action:** **Improve design** if txIds are not operationally required in view contract; keep compact aggregates only.

### Finding B4 — Runtime replay budget only checked during snapshot rebuild path
- **Severity:** Minor
- **Evidence:** `enforceReplayBudget` is called only when `snapshotPolicy` triggers `rebuildWithSnapshot()`. Non-snapshot startup path does not enforce replay budget. (`packages/runtime-local/src/index.ts`)
- **Risk:** Unexpected startup time under long histories when snapshotPolicy disabled.
- **Recommended action:** **Fix or document** budget scope explicitly.

---

## C) Security and Abstraction Breaches

### Finding C1 — CLI error channel may expose raw internal error strings
- **Severity:** Minor
- **Evidence:** `printError` writes raw `Error.message` to stderr without sanitization. (`packages/cli/src/index.ts`)
- **Risk:** Internal fault-injection markers, parser internals, or filesystem details can leak.
- **Recommended action:** **Improve** with controlled/user-facing reason mapping in normal mode; reserve verbose details for debug flags.

### Finding C2 — Error path prints help text on stdout
- **Severity:** Minor
- **Evidence:** On missing required flag, CLI prints error (stderr) then help text to stdout even with exit code 1. (`packages/cli/src/index.ts`)
- **Risk:** Automation that expects clean stdout on non-zero exits can ingest non-JSON noise.
- **Recommended action:** **Fix** by routing help-on-error to stderr (or gating with explicit `--help`).

---

## D) Determinism Guarantees

### Finding D1 — `read()` purity appears upheld
- **Severity:** Positive/Informational
- **Evidence:** Runtime `read()` performs projection incremental read only and does not call snapshot maintenance; tests assert snapshot file unchanged across `read()`. (`packages/runtime-local/src/index.ts`, `packages/runtime-local/test/runtime-local.test.ts`, `packages/runtime-local/test/snapshot-policy.test.ts`)
- **Spec/doc reference:** Operational guarantees require pure `read()`. (`docs/operational-guarantees.md`)
- **Recommended action:** **Keep** and extend tests to cover compaction-enabled environments.

### Finding D2 — `head.tx` currently equals numeric cursor string
- **Severity:** Minor
- **Evidence:** `head.tx` is `String(view.cursor)`. (`packages/runtime-local/src/index.ts`)
- **Risk:** Although documented opaque, numeric encoding encourages ordering misuse by clients.
- **Recommended action:** **Improve** by switching to opaque token format (e.g., prefixed/encoded cursor) and documenting equality-only semantics.

### Finding D3 — Idempotency determinism gap (canonical semantics missing)
- **Severity:** Major
- **Evidence:** Same as A1: direct `JSON.stringify` hash and TODO marker. (`packages/kernel-minimal/src/KernelMinimalImpl.ts`)
- **Spec reference:** deterministic stable hash invariant. (`specs/Mesh_Execution_Compiled_v_1.md`)
- **Recommended action:** **Fix + tests** for semantic-equality idempotency.

---

## E) Performance / Scalability Signals

### Finding E1 — Full-range reads use `Number.MAX_SAFE_INTEGER`
- **Severity:** Minor
- **Evidence:** Rebuild/incremental use very large limits for replay reads. (`packages/projection-minimal/src/index.ts`)
- **Risk:** Large allocations and latency spikes on cold rebuilds.
- **Recommended action:** **Improve** with chunked iteration and bounded batch sizes.

### Finding E2 — Rebuild path repeats full-event filtering per tx
- **Severity:** Major
- **Evidence:** `readPrincipalTxRange/getPrincipalCursorHead` repeatedly filter arrays per tx entry. (`packages/eventstore-local/src/FileBackedLocalEventStore.ts`, `packages/eventstore-local/src/InMemoryLocalEventStore.ts`)
- **Risk:** Throughput collapse under large datasets.
- **Recommended action:** **Fix** data structures and benchmark regression.

---

## F) CLI Usability & Output Consistency

### Finding F1 — Success-path JSON/exit semantics mostly conformant
- **Severity:** Positive/Informational
- **Evidence:** `write` emits JSON and maps committed→0 / rejected→2; runtime/parse exceptions return 1. `read/status/version` return 0 on success. (`packages/cli/src/index.ts`)
- **Doc reference:** operational exit code mapping and stdout/stderr contract. (`docs/operational-guarantees.md`)
- **Recommended action:** **Keep**.

### Finding F2 — Help output is plain text and on stdout
- **Severity:** Minor
- **Evidence:** `printHelp()` writes usage text, not JSON. (`packages/cli/src/index.ts`)
- **Context:** Package README says “all non-help output is JSON,” so this is internally consistent. (`packages/cli/README.md`)
- **Recommended action:** **Doc clarity** in top-level operational docs: explicitly exempt help from JSON contract.

### Finding F3 — Error+help mixed channel can confuse machine callers
- **Severity:** Minor
- **Evidence:** Missing flag path prints help to stdout despite error code. (`packages/cli/src/index.ts`)
- **Recommended action:** **Fix** channel hygiene (stderr only on failures).

---

## G) Test Coverage Gaps

### Well-covered
- Runtime restart head/view stability and read purity around snapshot files. (`packages/runtime-local/test/runtime-local.test.ts`, `packages/runtime-local/test/snapshot-policy.test.ts`)
- CLI integration for restart persistence and key exit-code mapping. (`packages/cli/test/cli.integration.test.ts`)

### Gaps
1. **Canonical idempotency hash invariants** (same semantic payload, different key order) — currently untested.
2. **`head.tx` opacity contract** (ensure clients/tests don’t rely on numeric ordering).
3. **Principal-cursor semantics under compaction/visibility changes** for `readPrincipalTxRange` fallback path.
4. **Large-history performance regression tests** for O(N²) scans and snapshot payload growth.
5. **CLI stdout hygiene on error** (assert no stdout data for non-zero exits except explicit command-defined cases).
6. **Multi-rootDir isolation stress tests** across concurrent CLI/runtime invocations.

- **Recommended action:** **Add tests** for the above before 15-C hardening closure.

---

## H) Documentation & Non-goals

### Finding H1 — Operational guarantees doc is useful but narrow
- **Severity:** Minor
- **Evidence:** `docs/operational-guarantees.md` documents startup/read/exit contracts but does not capture clear non-goals/limitations (e.g., IndexedDB not yet implemented, current hash placeholder, scalability limits). (`docs/operational-guarantees.md`)
- **Recommended action:** **Improve docs** with explicit phase limitations and known deviations.

### Finding H2 — Versioning policy exists in spec but not mirrored in operational docs
- **Severity:** Minor
- **Evidence:** Spec states version-stable artifacts require explicit version increments and no silent modification; this is not mirrored in operational README/docs for runtime/CLI contract changes. (`specs/Mesh_Execution_Compiled_v_1.md`, `docs/operational-guarantees.md`)
- **Recommended action:** **Improve docs/process** by adding a local contract/versioning section for runtime-local+CLI outputs.

---

## Priority hardening recommendations for 15-C

1. Implement canonical idempotency hashing and add determinism tests (Critical hardening path).
2. Normalize principal cursor semantics in local eventstores and add compaction/ACL edge tests.
3. Remove O(N²) tx materialization patterns in read paths.
4. Tighten CLI channel hygiene for error paths (stderr-only failures).
5. Document explicit phase non-goals/deviations and contract versioning policy.

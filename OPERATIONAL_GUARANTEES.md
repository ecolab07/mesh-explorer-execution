# OPERATIONAL_GUARANTEES

## 1) Scope

- These guarantees describe the current implementation in this repository: `@mesh/runtime-local`, `@mesh/cli`, and local event-store backends.
- They are implementation guarantees for local execution only.
- They are **not** a Remote/Sync service-level promise.
- Runtime and CLI packages are ESM-only and must run in supported Node.js environments.

## 2) Guarantees enforced today (Implemented)

- **Append-only log behavior:** committed events and committed transaction index entries MUST NOT be mutated in place by normal write/read paths.
- **Strict tx-closed reads:** reads MUST NOT expose a partial transaction; range reads are extended to transaction boundaries when needed.
- **Per-stream total order:** `meta` and `graph` streams MUST each preserve total order by monotonically increasing `seq`; implementation MUST NOT claim a global total order across both streams.
- **In-transaction semantic order:** for a committed transaction, `meta` events MUST be materialized before `graph` events in storage assembly.
- **Deterministic replay at admissible cursor:** projection rebuild/incremental replay MUST produce deterministic state for the same persisted log and cursor.
- **Persistent idempotency:** same `(actorId, idempotencyKey)` with same payload hash MUST return the same final committed receipt; same key with different payload hash MUST be rejected.
- **Receipt-only confirmation:** commit confirmation MUST be based on returned transaction receipt (`status: committed`), not on transport/process-level acknowledgement.
- **Snapshots are non-canonical:** snapshots MUST be treated as cache/acceleration artifacts, MAY be invalidated/rebuilt, and MUST NOT be treated as source of truth.
- **CLI process contract:** machine-readable success output MUST be JSON on `stdout`; errors MUST be emitted on `stderr`; documented non-zero exit codes MUST be used for failure/rejection paths.

## 3) Guarantees specified but NOT activated (Spec-ready / Not active)

The following are specified in v1 specs but are **not activated in current `@mesh/runtime-local` execution**:

- Enforcement of `allow | deny | mask` semantics as an active runtime security policy on read/write surfaces.
- Non-revealing mask behavior that is user-safe and indistinguishable from `NOT_FOUND`.
- Principal-filtered cursors with no observable holes from masked transactions.
- Strict transactional masking semantics (if one event is masked, entire transaction is masked).
- Principal-scoped projection-cache behavior as an enforced security boundary.
- Sync filtering behavior and distinct admin-safe vs user-safe response surfaces.

## 4) Recovery & determinism notes

- Poll/read state is the source of truth for committed visibility in local runtime flows.
- Determinism relies on replaying persisted tx order and idempotency records; no additional delivery guarantees are claimed here.

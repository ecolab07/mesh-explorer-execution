# Mesh Execution — Compiled v1
Version: 1.0
Status: Compiled (verbatim, sans modification)
Scope: Compilation intégrale Phase 8.x — Exécution Technique

---

## Source: technical_execution_v_1.md

# Mesh Explorer — Phase 8.x

## Technical Execution v1.1 (Consolidated)

Status: Normative Scope: EventStore Local v1 + Kernel Minimal + Command/Receipt + Conformance Critical Tests Architecture Freeze Reference: 4.x / 5.x / 6.x / 7.x locked MVP Mode: Single-writer strict

This version consolidates structural clarifications derived from the frozen specifications (Core, Security, Sync, Application, Product Strategy, Compliance).

---

# 1. Non‑Negotiable Invariants

The following constraints are binding and transitive across all layers:

1. Append-only EventStore.
2. No mutation of committed events.
3. Two streams: `meta` and `graph`, total order per stream only.
4. Transactions are atomic and tx-closed.
5. No partial transaction may ever be observable.
6. Semantic intra-transaction order: meta → graph.
7. Determinism by replay at admissible cursor.
8. Strict idempotency (persistent).
9. Mask is non-leaking and transaction-wide.
10. Cursor exposed to UI is principal-filtered.
11. Projection ≠ truth.
12. Receipt-only confirmation.

Any violation is Critical.

---

# 2. EventStore Local v1 — Normative Specification (Consolidated)

## 2.1 Namespacing

Even if MVP uses a single active Workspace, the Local EventStore MUST be namespaced by `graphSpaceId`.

Reason:

- Identity & Addressing v1 defines graphSpaceId as canonical root.
- Import/Export and future Remote compatibility require isolation.

Failure to namespace from the start = Structural Risk.

---

## 2.2 Data Model

Per graphSpaceId:

- Stream `meta`
- Stream `graph`

Each stream:

- Strictly increasing `seq`
- Append-only

Each transaction (TxBundle):

- Unique `txId`
- 0..N meta events
- 0..N graph events
- MUST NOT be empty

EventStore MUST maintain:

- txId → { metaSeq[], graphSeq[] }
- streamSeq → txId

This indexing is mandatory to support tx-closed reads and future transaction-level masking.

---

## 2.3 Append Semantics

appendTx(graphSpaceId, txBundle)

Requirements:

1. All seq assigned atomically.
2. Strict monotonic increase per stream.
3. Commit is atomic.
4. No partial write.
5. cursorAfter reflects both stream heads.

Violation category: Critical.

---

## 2.4 Read Semantics (tx-closed strict)

readRange(stream, fromSeqExclusive, limit, mode=TX\_CLOSED)

Normative behavior:

- No partial transaction may be returned.
- If `limit` cuts inside a transaction:
  - The store MUST extend the result to include the full transaction.
  - It MUST NOT reject in a way that reveals internal structure.
  - It MUST NOT return a prefix.

Rationale:

- tx-closed invariant.
- Projection determinism.
- Security non-fuite.

Violation category: Critical.

---

## 2.5 readTx(txId)

Must return full TxBundle.

Replay order MUST be:

1. meta events
2. graph events

Violation category: Critical.

---

# 3. Kernel Minimal — Consolidated Specification

## 3.1 Responsibilities

Kernel MUST:

- Validate command structure.
- Enforce idempotency.
- Acquire locks (if applicable).
- Build TxBundle.
- Append to EventStore.
- Persist idempotency result.
- Emit AuditRecord.
- Return TransactionReceipt or CommandError.

Kernel MUST NOT:

- Perform projection.
- Perform sync.
- Bypass permissions.
- Leak masked information.

---

## 3.2 Idempotency Model

Key: (actor, idempotencyKey)

Rules:

1. Same key + same payload → identical final result.
2. Same key + different payload → rejected.
3. Idempotency MUST survive crash/reload.

### 3.2.1 Atomicity Rule (Local Backend)

In the Local backend:

The EventStore append and the IdempotencyStore write MUST occur within the same IndexedDB transaction (or strictly equivalent commit-or-nothing mechanism).

Forbidden states:

- Events committed without idempotency entry.
- Idempotency entry without corresponding events.

Violation category: Critical.

---

## 3.3 baseGraphRevision — Opaque Resolution

baseGraphRevision MUST be an opaque token.

It:

- MUST NOT be directly comparable to graphSeq in UI.
- MUST be resolved by Kernel only.
- MUST be non-revealing (resolveRevision indistinguishable under mask).

Implementation requirement:

baseGraphRevision = opaque structure internally resolvable to a canonical cursor state.

Improper implementation = Critical (mask leak or overlay divergence).

---

# 4. Cursor Model — Structural Clarification

EventStore maintains:

- Internal global cursor (metaSeq, graphSeq).

Future filtering requirement:

- Principal-filtered cursor MUST preserve:
  - monotonicity
  - tx-closed
  - absence of observable holes

Masking rule:

If one event of a transaction is masked → entire transaction masked.

Therefore:

Filtering operates at transaction level, never event level.

EventStore structure MUST support this.

---

# 5. Projection Interaction Requirements

Projection Engine v1 is read-only.

Event batches applied to projection MUST:

- be tx-closed
- preserve meta → graph order
- be deterministic at identical cursor

Snapshots are non-canonical and invalidable.

EventStore must already satisfy strict tx-closed before projection.

---

# 6. Audit Log Integration (Minimal v1)

AuditLog is append-only and separate from EventStore.

For each TransactionReceipt:

- MUST emit at least one AuditRecord
- MUST include commandId, txId, cursorAfter, eventRefs

For each CommandError:

- MUST include category, reasonCode, masked, retryable

Audit surfaces MUST respect mask rules.

---

# 7. Consolidated Implementation Order (Aligned with Phasing Plan)

Phase 1 — Local Cohesive Core

1. EventStore Local strict (namespaced, indexed, tx-closed).
2. Kernel + idempotency (atomic rule enforced).
3. Local poll respecting tx-closed.
4. Deterministic projection engine.
5. Cursor filtering scaffolding.
6. Overlay workflow strict.
7. Transactional masking enforcement.
8. All Critical tests pass locally.

No remote before Phase 1 complete.

---

# 8. Risk Classification (Updated)

Critical:

- tx-closed violation
- Partial transaction exposure
- Event mutation
- Idempotency inconsistency
- Non-atomic idempotency write
- Mask leakage
- Incorrect baseGraphRevision resolution

Structural:

- Missing graphSpace namespacing
- Missing txId indexing
- Cursor model incompatible with filtering

Acceptable (MVP scope):

- No performance optimization
- No multi-writer
- No advanced observability dashboards

---

# 9. Local EventStore (IndexedDB) — Concrete Implementation Spec v1.1

---

## 9.0 Authority Model Clarification (Normative Lock)

### 9.0.1 Event Log as Sole Authoritative Source

The only authoritative source of transactional truth is the append-only event streams (`meta_events`, `graph_events`).

The following structures are strictly derived and MUST NEVER be treated as primary authority:

- `tx_index`
- `heads`
- `revisions`
- `idempotency`

Normative rule:

If any derived structure becomes inconsistent with the underlying event streams, the implementation MUST:

- treat this as corruption,
- fail safely with `CMD.INTERNAL.EVENTSTORE.CORRUPT_TX_INDEX` (or equivalent INTERNAL error),
- NEVER silently reconstruct a conflicting alternative history.

### 9.0.2 tx\_index Status

`tx_index` is:

- Atomically written together with events.
- A performance and boundary index.
- Not an independent source of transactional truth.

All invariants of `tx_index` MUST be derivable from the event streams alone.

CT-L-4 enforces this derivability.

Violation category: Critical.

---

# 9. Local EventStore (IndexedDB) — Concrete Implementation Spec v1.1

Status: Normative Layer: Persistence (Local) Backend: IndexedDB Purpose: Provide an EventStore-compatible local backend with tx-closed guarantees and atomic idempotency.

This section is implementation-grade: stores, keys, indexes, and algorithms.

---

## 9.1 Database and Stores

Database name:

- `mesh_local_v1`

Object stores (all under the same IndexedDB database):

### 9.1.1 `meta_events`

Key:

- `pk = [graphSpaceId, metaSeq]`

Value (persisted envelope):

- `graphSpaceId: string`
- `stream: "meta"`
- `seq: number`
- `txId: string`
- `eventId: string`
- `payload: object` (canonical event payload)
- `createdAt?: string` (optional; if present, must be treated as non-deterministic in tests)

Indexes:

- `by_tx` on `[graphSpaceId, txId, seq]`

### 9.1.2 `graph_events`

Key:

- `pk = [graphSpaceId, graphSeq]`

Value:

- `graphSpaceId: string`
- `stream: "graph"`
- `seq: number`
- `txId: string`
- `eventId: string`
- `payload: object`
- `createdAt?: string`

Indexes:

- `by_tx` on `[graphSpaceId, txId, seq]`

### 9.1.3 `tx_index`

Purpose: tx boundary + cross-stream membership.

Key:

- `pk = [graphSpaceId, txId]`

Value:

- `graphSpaceId: string`
- `txId: string`
- `metaSeqStart: number`
- `metaSeqEnd: number`
- `graphSeqStart: number`
- `graphSeqEnd: number`
- `metaCount: number`
- `graphCount: number`

Indexes:

- `by_metaSeqStart` on `[graphSpaceId, metaSeqStart]`
- `by_graphSeqStart` on `[graphSpaceId, graphSeqStart]`

Normative notes:

- `metaSeqEnd` and `graphSeqEnd` are inclusive.
- A transaction MAY have metaCount=0 or graphCount=0, but MUST NOT have both 0.

### 9.1.4 `heads`

Purpose: cursor heads per graphSpace.

Key:

- `pk = graphSpaceId`

Value:

- `graphSpaceId: string`
- `metaHead: number` (last committed metaSeq, 0 if none)
- `graphHead: number` (last committed graphSeq, 0 if none)

### 9.1.5 `idempotency`

Purpose: strict idempotency persistence.

Key:

- `pk = [graphSpaceId, actorId, idempotencyKey]`

Value:

- `graphSpaceId: string`
- `actorId: string`
- `idempotencyKey: string`
- `payloadHash: string` (stable hash of canonical command payload)
- `status: "committed" | "rejected"`
- `result: TransactionReceipt | CommandError` (serialized)
- `createdAt?: string`

Indexes:

- `by_actor` on `[graphSpaceId, actorId]`

### 9.1.6 `revisions` (optional but recommended)

Purpose: resolve opaque baseGraphRevision without UI-side comparisons.

Key:

- `pk = [graphSpaceId, revisionToken]`

Value:

- `graphSpaceId: string`
- `revisionToken: string` (opaque)
- `cursor: { metaSeq: number, graphSeq: number }`
- `createdAt?: string`

Security note:

- This store MUST NOT be exposed directly to user-safe surfaces.

---

## 9.2 Transaction Boundaries and Atomicity

### 9.2.1 Atomic write set (Local Backend)

The following writes MUST be performed in a single IndexedDB transaction (readwrite), commit-or-nothing:

- `meta_events` inserts (0..N)
- `graph_events` inserts (0..N)
- `tx_index` insert (exactly 1)
- `heads` update (exactly 1)
- `idempotency` upsert (exactly 1)
- `revisions` insert (optional, 0..1)

Forbidden outcomes remain:

- Events without idempotency.
- Idempotency without events.

Violation: Critical.

### 9.2.2 Single-writer assumptions (Local)

Because MVP is single-writer strict:

- No concurrent appendTx is expected.
- Nevertheless, `heads` update MUST use a read-then-write within the same IDB transaction to prevent intra-process races.

---

## 9.3 Canonical Hashing Requirements

`payloadHash` MUST be computed on a canonical serialization of the command payload:

- stable key ordering
- stable collection ordering where applicable
- exclusion/normalization of non-deterministic fields

The hashing algorithm choice is implementation-defined, but MUST be stable across runs.

If the same (actorId, idempotencyKey) is used with a different `payloadHash`, the kernel MUST reject.

---

## 9.4 Algorithms (Normative)

Notation:

- `H = heads[graphSpaceId]`
- `metaHead = H.metaHead`
- `graphHead = H.graphHead`

### 9.4.1 appendTx(graphSpaceId, txBundle, idempotencyKeyCtx)

Inputs:

- `graphSpaceId`
- `txBundle = { txId, metaEvents[], graphEvents[] }`
- `idempotencyKeyCtx = { actorId, idempotencyKey, payloadHash }`

Preconditions:

- txBundle is not empty.
- eventIds inside the txBundle are unique.

Algorithm (within ONE IndexedDB transaction):

1. Read `idempotency` at `[graphSpaceId, actorId, idempotencyKey]`.

- If entry exists:
  - If `payloadHash` matches: return stored `result` exactly.
  - Else: write a rejected CommandError (conflict) ONLY if not already committed; return rejection.

2. Read `heads[graphSpaceId]` (create if missing with 0/0).

3. Allocate sequences:

- `metaSeqStart = metaHead + 1` if metaCount>0 else `metaSeqStart = metaHead` and `metaSeqEnd = metaHead`
- `graphSeqStart = graphHead + 1` if graphCount>0 else `graphSeqStart = graphHead` and `graphSeqEnd = graphHead`

4. Insert meta events:

For i in [0..metaCount-1]:

- seq = metaSeqStart + i
- put into `meta_events` at pk `[graphSpaceId, seq]` value { stream:"meta", seq, txId, eventId, payload }

5. Insert graph events:

For i in [0..graphCount-1]:

- seq = graphSeqStart + i
- put into `graph_events` at pk `[graphSpaceId, seq]` value { stream:"graph", seq, txId, eventId, payload }

6. Insert tx boundary record into `tx_index` at `[graphSpaceId, txId]`:

- metaSeqStart/metaSeqEnd, graphSeqStart/graphSeqEnd, metaCount, graphCount

7. Update `heads[graphSpaceId]`:

- metaHead' = metaSeqEnd (if metaCount>0 else metaHead)
- graphHead' = graphSeqEnd (if graphCount>0 else graphHead)

8. (Optional) Insert `revisions` mapping if the kernel produces a new revisionToken for this commit.

9. Create TransactionReceipt:

- `cursorAfter = { metaSeq: metaHead', graphSeq: graphHead' }`
- `eventRefs` MUST list (stream, seq, eventId) for all inserted events.

10. Upsert `idempotency` at `[graphSpaceId, actorId, idempotencyKey]` with:

- payloadHash
- status="committed"
- result=receipt

11. Commit IDB transaction.

Outputs:

- TransactionReceipt

Violation categories:

- Any partial write exposure: Critical.

---

### 9.4.2 readTx(graphSpaceId, txId)

Algorithm:

1. Get `tx_index[graphSpaceId, txId]`.
2. Read meta range if metaCount>0: `meta_events` from metaSeqStart..metaSeqEnd.
3. Read graph range if graphCount>0: `graph_events` from graphSeqStart..graphSeqEnd.
4. Return TxBundle with explicit ordering: meta[] then graph[].

If txId not found: return NOT\_FOUND (user-safe masking rules apply at higher layers).

---

### 9.4.3 readRange(graphSpaceId, stream, fromSeqExclusive, limit, mode=TX\_CLOSED)

Normative requirement: never return a partial transaction.

Algorithm (TX\_CLOSED):

1. Determine `startSeq = fromSeqExclusive + 1`.

2. Read up to `limit` events starting at `startSeq` from the chosen store (`meta_events` or `graph_events`) by key order.

- If no events: return empty.

3. Let `lastEvent` be the last event read. Let `lastTxId = lastEvent.txId`.

4. Fetch `tx_index[graphSpaceId, lastTxId]` and determine the inclusive `txEndSeq` for the chosen stream:

- if stream=meta: `txEndSeq = metaSeqEnd`
- if stream=graph: `txEndSeq = graphSeqEnd`

5. If `lastEvent.seq < txEndSeq` then the read cut inside a transaction.

- The store MUST extend the read to include all remaining events of that transaction up to txEndSeq.

6. Return the resulting event list.

Additional constraint:

- The store MUST NOT signal an error that depends on whether the boundary was cut.

---

### 9.4.4 getCursorHead(graphSpaceId)

- Read `heads[graphSpaceId]`, default {0,0}.
- Return `{ metaSeq: metaHead, graphSeq: graphHead }`.

---

### 9.4.5 resolveRevision(graphSpaceId, revisionToken)

- Read `revisions[graphSpaceId, revisionToken]`.
- Return cursor if found.
- If not found, return a single user-safe NOT\_FOUND-equivalent outcome.

Non-revealing requirement applies at higher layers, but Local MUST not create distinguishable error shapes.

---

# 10. Conformance — Critical Tests (Local Persistence Level)

This section defines the first executable tests for the Local backend.

## CT-L-1 Append-only immutability (Critical)

- appendTx
- readTx
- readRange
- Assert canonical equality on re-read.

## CT-L-2 tx-closed readRange extension (Critical)

- appendTx with multi-event tx in chosen stream
- readRange with limit that would cut
- Assert returned list includes full transaction.
- Assert no prefix-only possible.

## CT-L-3 Two-stream ordering (Critical)

- Append N txs
- Assert meta seq strictly increases in meta stream
- Assert graph seq strictly increases in graph stream

## CT-L-4 Tx boundary integrity (Critical)

- For each txId, tx\_index ranges match actual stored events.

## CT-L-5 Idempotency atomicity crash-safety (Critical, simulated)

Given we cannot rely on real crash during tests, simulate via fault injection:

- Inject failure before IDB commit.
- Assert neither events nor idempotency entry exist.

Then:

- Normal append succeeds.
- Assert both events and idempotency exist.

---

# 11. Code Interfaces (TypeScript) — Contracts v1.1

Status: Normative Scope: Local EventStore + Kernel Minimal supporting CT-L-\* tests.

This section defines code-level interfaces that MUST remain stable across implementation iterations.

---

## 11.1 Core Types

```ts
export type GraphSpaceId = string;
export type TxId = string;
export type EventId = string;
export type ActorId = string;
export type IdempotencyKey = string;
export type PayloadHash = string;

export type StreamName = "meta" | "graph";

export interface Cursor {
  metaSeq: number;
  graphSeq: number;
}

export interface EventRef {
  stream: StreamName;
  seq: number;
  eventId: EventId;
}

export interface TxBundle {
  txId: TxId;
  metaEvents: CanonicalEventPayload[];  // payloads only; envelopes assigned by store
  graphEvents: CanonicalEventPayload[];
}

export type CanonicalEventPayload = Record<string, unknown>;

export interface EventEnvelope {
  graphSpaceId: GraphSpaceId;
  stream: StreamName;
  seq: number;
  txId: TxId;
  eventId: EventId;
  payload: CanonicalEventPayload;
  createdAt?: string;
}
```

Normative notes:

- `createdAt` MAY exist but MUST be treated as non-deterministic in conformance tests.
- Ordering guarantees: total order per stream only.

---

## 11.2 Command / Receipt / Error (Minimal)

```ts
export interface Command {
  graphSpaceId: GraphSpaceId;
  commandId: string;
  actorId: ActorId;
  idempotencyKey: IdempotencyKey;
  payload: Record<string, unknown>;
  requireBaseRevision?: string; // baseGraphRevision token (opaque)
}

export type CommandOutcome = TransactionReceipt | CommandError;

export interface TransactionReceipt {
  status: "committed";
  commandId: string;
  txId: TxId;
  cursorAfter: Cursor;
  eventRefs: {
    meta: EventRef[];
    graph: EventRef[];
  };
}

export type CommandErrorCategory =
  | "VALIDATION"
  | "PERMISSION"
  | "CONFLICT"
  | "PRECONDITION"
  | "NOT_FOUND"
  | "INTERNAL";

export interface CommandError {
  status: "rejected" | "error";
  commandId?: string;
  category: CommandErrorCategory;
  reasonCode: string;
  masked?: boolean;
  retryable?: boolean;
}
```

Normative notes:

- Reason codes MUST be stable.
- `masked=true` MUST be representable without leaking target existence.

---

## 11.3 Canonical Hashing Contract

```ts
export interface CanonicalHasher {
  /**
   * Returns a stable hash over a canonical serialization.
   * MUST be deterministic across runs.
   */
  hashCanonical(value: unknown): PayloadHash;
}
```

Normative requirements:

- MUST sort object keys.
- MUST normalize collections when their order is not semantically meaningful.
- MUST exclude or normalize non-deterministic fields (timestamps, random ids) from the hashed view.

---

## 11.4 Local EventStore Contract

```ts
export type ReadMode = "TX_CLOSED";

export interface LocalEventStore {
  appendTx(
    graphSpaceId: GraphSpaceId,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx,
    hooks?: FaultInjectionHooks
  ): Promise<TransactionReceipt | CommandError>;

  readTx(graphSpaceId: GraphSpaceId, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null>;

  readRange(
    graphSpaceId: GraphSpaceId,
    stream: StreamName,
    fromSeqExclusive: number,
    limit: number,
    mode: ReadMode
  ): Promise<EventEnvelope[]>;

  getCursorHead(graphSpaceId: GraphSpaceId): Promise<Cursor>;

  resolveRevision(graphSpaceId: GraphSpaceId, revisionToken: string): Promise<Cursor | null>;
}

export interface IdempotencyCtx {
  actorId: ActorId;
  idempotencyKey: IdempotencyKey;
  payloadHash: PayloadHash;
}
```

Normative notes:

- `appendTx` MUST implement the atomic write set defined in §9.2.1.
- `readRange(..., mode="TX_CLOSED")` MUST extend to include full transaction when cut by limit.

---

## 11.5 Kernel Minimal Contract

```ts
export interface KernelMinimal {
  execute(cmd: Command, hooks?: FaultInjectionHooks): Promise<CommandOutcome>;
}
```

Normative notes:

- Kernel MUST enforce idempotency using the Local backend `idempotency` store.
- Kernel MUST not confirm success without returning a TransactionReceipt.

---

# 12. Fault Injection Hooks (for CT-L-5) — Minimal Normative Mechanism

Status: Normative Goal: simulate crash/failure before IndexedDB commit and verify commit-or-nothing.

The implementation MUST expose a test-only hook layer that can force a failure at deterministic cut points inside the single IndexedDB transaction.

## 12.1 Hook Interface

```ts
export type FaultPoint =
  | "BEFORE_ANY_WRITE"
  | "AFTER_META_EVENTS"
  | "AFTER_GRAPH_EVENTS"
  | "AFTER_TX_INDEX"
  | "AFTER_HEADS_UPDATE"
  | "AFTER_IDEMPOTENCY_UPSERT"
  | "BEFORE_IDB_COMMIT";

export interface FaultInjectionHooks {
  /** If set, the operation MUST throw at the specified point. */
  failAt?: FaultPoint;

  /** Optional: invoked when the code reaches a fault point (for tracing). */
  onPoint?: (p: FaultPoint) => void;
}
```

## 12.2 Normative Behavior Under Fault

If a fault is triggered at ANY point prior to IDB commit:

- The IndexedDB transaction MUST abort.
- No events MUST be visible.
- No tx\_index record MUST be visible.
- No heads update MUST be visible.
- No idempotency entry MUST be visible.

Violation: Critical.

## 12.3 CT-L-5 Binding

CT-L-5 MUST be implemented as follows:

1. Execute appendTx/execute(cmd) with `hooks.failAt="BEFORE_IDB_COMMIT"`.
2. Assert:
   - getCursorHead unchanged
   - readRange returns no new events
   - idempotency lookup returns null
3. Execute same command normally.
4. Assert:
   - events exist
   - idempotency entry exists
   - re-execute returns identical stored receipt

---

# 13. Reason Codes (Minimal Set) — Normative v1.1

Status: Normative Scope: Kernel Minimal + Local EventStore (errors produced before Sync/Projection).

Reason codes MUST be stable and machine-checkable.

## 13.1 Naming Convention

Format:

- `CMD.<CATEGORY>.<SUBSYSTEM>.<DETAIL>`

Examples:

- `CMD.VALIDATION.KERNEL.EMPTY_TX`
- `CMD.CONFLICT.IDEMPOTENCY.PAYLOAD_MISMATCH`

---

## 13.2 Minimal Required Codes

### Validation

- `CMD.VALIDATION.KERNEL.MALFORMED_COMMAND`

  - Missing required fields; invalid types.

- `CMD.VALIDATION.KERNEL.EMPTY_TX`

  - TxBundle has no meta events and no graph events.

- `CMD.VALIDATION.KERNEL.DUPLICATE_EVENT_ID_IN_TX`

  - Same eventId appears more than once in the same transaction.

- `CMD.VALIDATION.REVISION.INVALID_BASE_REVISION`

  - baseGraphRevision token not parseable / structurally invalid.

### Precondition

- `CMD.PRECONDITION.REVISION.MISMATCH`
  - baseGraphRevision resolves but does not match current canonical state.

### Conflict

- `CMD.CONFLICT.IDEMPOTENCY.PAYLOAD_MISMATCH`

  - Same (actorId, idempotencyKey) reused with different payloadHash.

- `CMD.CONFLICT.LOCKED`

  - Lock acquisition fails within timeout (reserved for later, but code is stable).

### Not Found / Mask

- `CMD.NOT_FOUND.GENERIC`
  - Single non-revealing user-safe not-found outcome.

### Internal

- `CMD.INTERNAL.EVENTSTORE.WRITE_FAILED`

  - Underlying IndexedDB failure.

- `CMD.INTERNAL.EVENTSTORE.CORRUPT_TX_INDEX`

  - tx\_index does not match stored events (should be caught by CT-L-4).

---

## 13.3 Masking Requirements (Error Surface)

When a target is masked, the user-safe surface MUST be indistinguishable from NOT\_FOUND.

Normative consequence:

- User-safe outcome uses category=NOT\_FOUND and reasonCode=`CMD.NOT_FOUND.GENERIC`.
- Admin-safe MAY retain original category/reasonCode and include `masked=true`.

This document defines codes; exposure policy is controlled by allow|deny|mask.

---

# 14. Canonical Normalization and Hashing — Normative v1.1

Status: Normative Scope: payloadHash computation + conformance test normalization.

Goal: stable equivalence across runs and storage backends.

## 14.1 Canonical JSON Rules

A Canonical JSON representation MUST:

1. Sort object keys lexicographically (Unicode code point order).
2. Preserve array order as-is (arrays are ordered).
3. For sets / maps / collections considered unordered by the domain:
   - convert to arrays
   - sort by a canonical comparator.
4. Disallow NaN/Infinity (must be rejected or normalized to string tokens).
5. Normalize integers vs floats:
   - if the language runtime has only `number`, treat numeric values as-is but avoid printing artifacts.
6. Exclude non-deterministic fields from canonical views used by hashes and equality checks.

Excluded by default from hashing and canonical equality:

- `createdAt`
- `timestamp`
- any field explicitly tagged as non-deterministic by the spec/harness

## 14.2 Domain Canonicalization (Command Payload)

Idempotency identity is defined as:

- Primary key: `(graphSpaceId, actorId, idempotencyKey)`
- Semantic equality guard: `payloadHash`

Normative clarification:

- Idempotency scope is PER graphSpaceId.
- Reuse of the same `(actorId, idempotencyKey)` across different graphSpaceId values is allowed and does not collide.

Therefore:

`payloadHash` MUST be computed over the semantic command content only:

- include:
  - `payload`
  - `requireBaseRevision` (if present)
- exclude:
  - `graphSpaceId` (already part of primary key scope)
  - `commandId`
  - transport metadata

Rationale:

- graphSpaceId is structurally part of idempotency key space.
- Including it in the hash would be redundant and semantically unnecessary.

Normative note:

Any future change to idempotency scoping rules requires a version bump of this specification.

## 14.3 Canonical Comparator for Unordered Collections

When sorting unordered collections in canonicalization:

- Prefer ordering by stable identifier fields if present (`id`, `eventId`, `txId`, `seq`).
- Otherwise, order by canonical JSON string of each element.

---

# 15. Conformance Harness — Minimal Normalizer Contract

Status: Normative Scope: CT-L-\* tests and future CT suites.

```ts
export interface Normalizer {
  /** Returns a canonical JSON string used for equality/golden comparisons. */
  canonicalString(value: unknown): string;

  /** Returns a deep-cloned value with non-deterministic fields removed. */
  stripNondeterminism<T>(value: T): T;
}
```

Normative requirements:

- MUST apply rules in §14.
- MUST be used for:
  - receipt equality assertions
  - event list equality
  - canonical state dumps

---

# 16. Canonical State Dump (EventStore‑Only) — Oracle B Minimal v1.1

Status: Normative Purpose: Provide a projection-free, persistence-level oracle for equivalence tests. Scope: Local EventStore, used by CT-L-1/2/3/4 and as a building block for higher-layer replay equivalence.

Principle:

- The dump MUST be fully reconstructible from the EventStore.
- The dump MUST be canonicalized (stable ordering, non-determinism removed).
- The dump MUST NOT include non-authoritative artifacts (caches, UI state).

---

## 16.1 CanonicalStateDump Schema

```ts
export interface CanonicalStateDump {
  version: "CSD-ES-1";
  graphSpaceId: string;
  cursorHead: { metaSeq: number; graphSeq: number };

  streams: {
    meta: CanonicalEventDump[];
    graph: CanonicalEventDump[];
  };

  txIndex: CanonicalTxIndexDump[];
}

export interface CanonicalEventDump {
  stream: "meta" | "graph";
  seq: number;
  txId: string;
  eventId: string;
  payload: Record<string, unknown>;
}

export interface CanonicalTxIndexDump {
  txId: string;
  meta: { start: number; end: number; count: number };
  graph: { start: number; end: number; count: number };
}
```

Normative notes:

- No timestamps.
- No createdAt.
- Payload MUST be canonicalized using §14.

---

## 16.2 Dump Construction Algorithm (Normative)

Input:

- `graphSpaceId`

Algorithm:

1. Read `cursorHead = getCursorHead(graphSpaceId)`.

2. Read full `meta` stream:

- `metaEvents = readRange(graphSpaceId, "meta", fromSeqExclusive=0, limit=INF, mode="TX_CLOSED")`

3. Read full `graph` stream:

- `graphEvents = readRange(graphSpaceId, "graph", fromSeqExclusive=0, limit=INF, mode="TX_CLOSED")`

4. Build `streams.meta` and `streams.graph` as arrays of CanonicalEventDump:

- include only {stream, seq, txId, eventId, payload}
- apply canonical normalization to payload

5. Read all tx\_index records for graphSpaceId.

Ordering requirement:

- `txIndex` MUST be sorted by:
  - `min(meta.start, graph.start)` ascending, with 0-count treated as +∞ for that stream
  - tie-breaker: `txId` lexicographic

6. Produce CanonicalStateDump with `version="CSD-ES-1"`.

---

## 16.3 Equivalence Rule (Normative)

Two EventStore states are considered equivalent for Oracle B (EventStore-only) if:

- Their CanonicalStateDump canonicalString is identical.

This equivalence deliberately ignores:

- non-deterministic timestamps
- internal storage layout

---

# 17. Conformance Bindings (Updated)

This section refines CT-L-\* to use CanonicalStateDump.

## CT-L-1 (Updated) — Append-only immutability

1. Append tx.
2. Dump state (D1).
3. Dump state again without writing (D2).
4. Assert D1 == D2.

Additionally:

- Attempting to overwrite an existing event key MUST be impossible by construction.

## CT-L-2 (Updated) — tx-closed extension

1. Append tx with K events in a single stream.
2. readRange with limit that would cut.
3. Assert returned events include full transaction end boundary.
4. Assert CanonicalStateDump remains identical regardless of paging strategy.

## CT-L-3 (Updated) — Stream ordering

- Compare `seq` monotonicity across dumps.

## CT-L-4 (Updated) — tx\_index integrity

- For each txIndex entry:
  - meta range count equals number of meta events with txId
  - graph range count equals number of graph events with txId
  - if count=0, start/end MUST equal previous head (no advancement)

---

# 18. KernelMinimal.execute — Normative Algorithm v1.1

Status: Normative Scope: Minimal command→tx→receipt pipeline (no Sync, no Projection).

This defines the first executable kernel behavior that can be tested end-to-end against the Local EventStore.

---

## 18.1 Kernel Dependencies (Minimal)

KernelMinimal requires:

- `LocalEventStore` (IndexedDB implementation)
- `CanonicalHasher`
- (Optional, deferred) LockManager
- (Optional, deferred) Permissions engine
- (Optional, deferred) AuditLog writer

In this minimal phase, the kernel MUST still emit an AuditRecord, but the persistence of AuditLog may be implemented as an in-memory sink or a separate append-only store (non-authoritative). Audit MUST NOT affect receipt determinism.

---

## 18.2 Minimal Command Routing

In Phase 1 core bring-up, the kernel MAY support a minimal command set whose only purpose is to exercise invariants and plumbing.

### 18.2.1 `CMD.NOOP` (Normative test command)

Payload form:

```json
{ "kind": "CMD.NOOP", "metaEvents": [ ... ]?, "graphEvents": [ ... ]? }
```

Rules:

- Kernel MUST build a TxBundle whose events are exactly those specified in payload, after validation.
- This command is reserved for conformance and may be excluded from product surfaces.

Rationale:

- Allows conformance to test EventStore + kernel invariants without requiring the full domain mutation engine.

---

## 18.3 Validation Rules (Minimal)

On every execute(cmd):

1. If required fields missing or wrong type → reject:

- category=VALIDATION
- reasonCode=`CMD.VALIDATION.KERNEL.MALFORMED_COMMAND`

2. Compute TxBundle candidate (see §18.4). If empty → reject:

- category=VALIDATION
- reasonCode=`CMD.VALIDATION.KERNEL.EMPTY_TX`

3. If duplicate eventId within the same TxBundle → reject:

- category=VALIDATION
- reasonCode=`CMD.VALIDATION.KERNEL.DUPLICATE_EVENT_ID_IN_TX`

4. If `requireBaseRevision` present:

- If token structurally invalid → reject:

  - category=VALIDATION
  - reasonCode=`CMD.VALIDATION.REVISION.INVALID_BASE_REVISION`

- Else resolve via `eventStore.resolveRevision(graphSpaceId, token)`.

  - If resolution fails or is not allowed under mask rules, user-safe MUST be indistinguishable from NOT\_FOUND.
  - In minimal local bring-up without permissions, resolution failure returns category=NOT\_FOUND, reasonCode=`CMD.NOT_FOUND.GENERIC`.

- If resolvedCursor != current head cursor → reject:

  - category=PRECONDITION
  - reasonCode=`CMD.PRECONDITION.REVISION.MISMATCH`

Notes:

- Equality is exact on both (metaSeq, graphSeq).
- UI MUST NOT compare token to seq directly; Kernel is sole resolver.

---

## 18.4 TxBundle Construction (Minimal)

For `CMD.NOOP`:

- `txId` is generated (opaque, unique).
- `metaEvents` and `graphEvents` are taken from payload arrays.
- Each event payload MUST include an `eventId` field (string) OR the kernel MUST generate eventIds deterministically within the tx.

Normative choice for this phase:

- Kernel MUST REQUIRE eventId to be provided in payload for conformance determinism.

Event payload shape for NOOP:

```json
{ "eventId": "E-...", "data": { ... } }
```

The EventStore envelope will store:

- `eventId` from payload
- `payload` = `data`

Violation of missing eventId → treat as MALFORMED\_COMMAND.

---

## 18.5 Idempotency Computation (Minimal)

The kernel MUST compute:

- `payloadHash = hasher.hashCanonical({ graphSpaceId, requireBaseRevision, payload })`

It MUST then call:

- `eventStore.appendTx(graphSpaceId, txBundle, { actorId, idempotencyKey, payloadHash }, hooks)`

The EventStore performs the atomic write set (events + idempotency) and returns:

- stored prior result if key existed with same hash
- rejection if key existed with different hash
- receipt if new

Kernel MUST forward this result unchanged.

---

## 18.6 Error Mapping Rules (Minimal)

- If EventStore returns `CommandError` with category=CONFLICT and reasonCode=`CMD.CONFLICT.IDEMPOTENCY.PAYLOAD_MISMATCH`, kernel MUST return it unchanged.

- If IndexedDB throws during appendTx, kernel MUST return:

  - category=INTERNAL
  - reasonCode=`CMD.INTERNAL.EVENTSTORE.WRITE_FAILED`
  - retryable=true

No other internal errors are allowed in v1.1 minimal; unexpected exceptions MUST be mapped to INTERNAL.

---

# 19. Conformance — Critical Tests (Kernel Path)

Status: Normative Scope: Command→Kernel→EventStore→Receipt (no projection).

These tests MUST run after CT-L-\*.

## CT-K-1 Receipt-only determinism (Critical)

1. Execute `CMD.NOOP` producing a receipt R1.
2. Execute the same command again (same actorId+idempotencyKey, identical payload) producing R2.
3. Assert canonicalString(R1) == canonicalString(R2).
4. Assert CanonicalStateDump unchanged between (after first) and (after second).

## CT-K-2 Idempotency mismatch rejection (Critical)

1. Execute cmd A with (actorId, idempotencyKey) and payload P.
2. Execute cmd B with same (actorId, idempotencyKey) but different payload P'.
3. Assert rejection:
   - category=CONFLICT
   - reasonCode=`CMD.CONFLICT.IDEMPOTENCY.PAYLOAD_MISMATCH`
4. Assert CanonicalStateDump unchanged by the rejected attempt.

## CT-K-3 Precondition mismatch (Critical)

1. Execute cmd A to advance cursor.
2. Execute cmd B with requireBaseRevision pointing to a prior revision token.
3. Assert rejection:
   - category=PRECONDITION
   - reasonCode=`CMD.PRECONDITION.REVISION.MISMATCH`
4. Assert CanonicalStateDump unchanged by rejected attempt.

## CT-K-4 Fault injection abort safety via Kernel (Critical)

1. Execute cmd with hooks.failAt="BEFORE\_IDB\_COMMIT".
2. Assert outcome is INTERNAL or error, but state dump unchanged.
3. Execute same cmd normally.
4. Assert receipt committed and idempotence works on retry.

---

# 20. Required Minimal Artifacts (Implementation Output)

The following concrete artifacts MUST be produced to claim Phase 1 readiness of this block:

1. `LocalEventStoreIndexedDB.ts` implementing §9 + §11.4.
2. `CanonicalHasher.ts` implementing §11.3 + §14.
3. `Normalizer.ts` implementing §15.
4. `KernelMinimal.ts` implementing §11.5 + §18.
5. Test suite:
   - `CT-L-*` implemented and passing
   - `CT-K-*` implemented and passing

---

# 21. Commit Path ↔ Permissions ↔ Mask — Structural Lock v1.1

Status: Normative Scope: Kernel commit path interaction with allow | deny | mask.

This section prevents future structural drift when permissions are activated.

---

## 21.1 Authorization Positioning

Authorization MUST occur:

- Before TxBundle is appended.
- Inside Kernel (not UI).
- Before idempotency entry is persisted as committed.

Order (normative future-ready pipeline):

1. Validate structure.
2. Resolve baseGraphRevision.
3. Authorize (allow | deny | mask).
4. If allow → proceed to appendTx.
5. If deny → return PERMISSION error.
6. If mask → return NOT\_FOUND user-safe outcome.

No events MUST be written for deny or mask outcomes.

Violation: Critical.

---

## 21.2 Mask Non-Leak Guarantee at Commit

If authorization decision is `mask`:

- Kernel MUST NOT:
  - Reveal existence of target.
  - Reveal that a transaction was attempted on a masked entity.
  - Reveal whether baseGraphRevision was valid.

User-safe outcome MUST be:

- category=NOT\_FOUND
- reasonCode=`CMD.NOT_FOUND.GENERIC`

Admin-safe MAY record true reason in AuditLog with `masked=true`.

---

## 21.3 Idempotency Under Mask

If a command results in mask outcome:

- Idempotency entry MAY be stored with status="rejected" and masked=true in admin-safe layer.
- User-safe retry MUST reproduce identical NOT\_FOUND outcome.

No canonical events are written.

---

## 21.4 Structural Guarantee

Permissions logic MUST NOT:

- Inspect projection state.
- Depend on derived entities.
- Bypass EventStore invariants.

Authorization operates strictly on canonical graph/meta state.

---

# 22. Overlay ↔ baseGraphRevision ↔ Single‑Writer — Structural Audit Lock v1.1

Status: Normative Scope: Overlay workflow preconditions and divergence behavior, consistent with single-writer MVP and no-merge/no-rebase constraints.

This section closes remaining structural ambiguity around overlay commit correctness.

---

## 22.1 Definitions

- **Overlay**: a non-canonical working plane whose contents may be committed to the canonical graph via Command → Kernel → EventStore.
- **baseGraphRevision**: an opaque token representing the canonical cursor state on which an overlay was created/last rebased.
- **Single-writer MVP**: at most one device/instance is allowed to append canonical transactions at a time. This does not eliminate canonical advancement caused by (a) the same writer across time, or (b) Sync/Poll applying remote canonical changes when remote is activated.

---

## 22.2 Overlay Creation Rule

When an overlay is created (draft/hypothesis/annotation):

- The system MUST capture an opaque `baseGraphRevision` token that resolves to the current canonical cursor head at creation time.
- This token MUST be stored as overlay metadata (overlay-local), not inside canonical graph.

Normative notes:

- UI MUST treat the token as opaque.
- UI MUST NOT compare it to seq values.

---

## 22.3 Overlay Commit Precondition Rule (No Merge / No Rebase)

Any command that commits an overlay MUST include:

- `requireBaseRevision = baseGraphRevision` (opaque token)

Kernel MUST enforce:

1. Resolve `requireBaseRevision` to a cursor `C_base` (non-revealing).
2. Read current canonical head cursor `C_head`.
3. If `C_base != C_head` → reject without writing events:

- category=PRECONDITION
- reasonCode=`CMD.PRECONDITION.REVISION.MISMATCH`

This is the only allowed divergence behavior in v1:

- No merge.
- No automatic rebase.
- No implicit partial application.

Violation category: Critical (if a divergent overlay can commit).

---

## 22.4 Non‑Leak Requirements Under Mask

If `requireBaseRevision` resolution fails due to masking or non-existence:

- User-safe outcome MUST be indistinguishable from NOT\_FOUND:
  - category=NOT\_FOUND
  - reasonCode=`CMD.NOT_FOUND.GENERIC`

Kernel MUST NOT reveal whether:

- the revision token existed,
- the underlying canonical state advanced,
- the overlay references masked entities.

Admin-safe MAY record diagnostics with `masked=true`.

---

## 22.5 Single‑Writer Interaction (Local and Sync)

Even in single-writer mode, overlays can become divergent because:

- The same writer advanced the canonical cursor after overlay creation.
- When Sync/Remote is enabled later, Poll can advance the local canonical cursor.

Therefore:

- The precondition check in §22.3 is mandatory even in MVP single-writer.
- UI MUST handle rejection as a first-class outcome (receipt-only) and MUST NOT attempt a merge.

---

## 22.6 Receipt-Only Implications for Overlay UX

UI MAY present speculative overlay state immediately.

However:

- No overlay is considered committed until a TransactionReceipt is received.
- Transport ack, local cache, or optimistic UI state MUST NOT be treated as commit.

---

## 22.7 Conformance Tests (Overlay Preconditions)

These tests are structural locks to be added once overlay commands exist beyond CMD.NOOP.

### CT-O-1 Overlay commit succeeds only on matching base revision (Critical)

1. Create overlay at head cursor → baseGraphRevision token T.
2. Commit overlay with requireBaseRevision=T.
3. Assert committed and cursor advances.

### CT-O-2 Overlay commit rejected on divergence (Critical)

1. Create overlay at head cursor → token T.
2. Append any canonical tx (advance head).
3. Attempt overlay commit with requireBaseRevision=T.
4. Assert rejection PRECONDITION.REVISION.MISMATCH and no state change.

### CT-O-3 Overlay commit non-leak on masked revision (Critical, security)

1. Use a permission fixture where revision resolution is masked.
2. Attempt commit with requireBaseRevision=masked token.
3. Assert user-safe NOT\_FOUND.GENERIC; no state change.

---

# End — Technical Execution v1.1 Consolidated

---

## Source: sync_poll_and_cursor_filtering_v_1.md

# Sync\_Poll\_and\_Cursor\_Filtering\_v1.md

Version: 1.1\
Status: Normative\
Scope: Local Poll + Cursor Model + Transaction-Level Filtering (preparation for Remote & principal filtering)

Compatible with:

- Technical\_Execution\_v1.1
- Sync\_Transport\_Layer\_v1
- Security\_Hardening\_v1
- Conformance\_Test\_Model\_v1

This document specifies the normative behavior of Local Poll, cursor progression, and transaction-level filtering scaffolding.

No subscribe, no remote, no UI semantics are defined here.

The design is tx-index–driven and compatible with strict tx-closed, masking, and principal-filtered cursors.

---

# 1. Local Poll Contract v1 (Tx-Index Driven)

## 1.1 Definition

```
poll(graphSpaceId, fromCursor, limits) -> {
  meta: EventEnvelope[]
  graph: EventEnvelope[]
  cursorAfter: { metaSeq, graphSeq }
}
```

Where:

- `fromCursor` = { metaSeq, graphSeq }
- `limits` = { meta: number, graph: number }

Poll is the authoritative recovery and synchronization mechanism.

Normative constraint:

Poll MUST be driven by transaction boundaries (`tx_index`), not by independent per-stream range reads.

---

## 1.2 Tx-Closed Strict Guarantee (Cross-Stream)

Poll MUST:

1. Never return a partial transaction.
2. Never expose a prefix of a transaction in any stream.
3. Never expose a transaction where only one stream is delivered if the other stream contains events for that same txId.
4. Deliver transactions atomically across both streams.

If a limit would cut inside a transaction:

- The poll algorithm MUST extend to include the full transaction.
- It MUST NOT truncate.
- It MUST NOT reject in a way revealing internal structure.

Violation: Critical.

---

## 1.3 Monotonicity (Component-wise)

Let:

- K\_before = fromCursor
- K\_after = cursorAfter

Poll MUST ensure:

- K\_after.metaSeq >= K\_before.metaSeq
- K\_after.graphSeq >= K\_before.graphSeq

Strict monotonicity applies if at least one transaction advancing that component is delivered.

CursorAfter MUST correspond to a transaction boundary.

---

## 1.4 Interaction with CanonicalStateDump (Oracle B)

Given a poll sequence from K0 to K1:

Applying returned events transactionally MUST produce a state equivalent (after normalization) to:

- CanonicalStateDump at K1.

Poll correctness is validated by Oracle B equivalence.

---

## 1.5 Input Cursor Admissibility (Required)

Poll MUST accept only an admissible `fromCursor` (tx boundary).

If `fromCursor` is not admissible (falls inside a transaction), Poll MUST return a single user-safe failure outcome and MUST NOT attempt a partial recovery from a mid-transaction position.

The failure outcome MUST be non-revealing (no txId, no boundary details).

Violation: Critical.

---

## 1.6 Limits Semantics (Tx-Aware)

`limits` expresses per-stream delivery caps for a single poll response.

Rules:

1. Poll MUST NOT stop in the middle of a transaction in order to satisfy limits.
2. Poll MAY exceed `limits.meta` and/or `limits.graph` only to complete the final delivered transaction.
3. Poll MUST NOT deliver a transaction if doing so would exceed a hard implementation cap that would break atomicity; in such a case it MUST return the prior tx-closed set and keep `cursorAfter = fromCursor`.

`limitsReached(deliveredTx, limits)` MUST be evaluated only at transaction boundaries.

---

# 2. Cursor Model — Internal vs Visible

## 2.1 Cursor Types

### 2.1.1 Internal Cursor (K\_internal)

Maintained by EventStore:

```
K_internal = (metaHead, graphHead)
```

Properties:

- Canonical
- Never exposed user-safe

---

### 2.1.2 Visible Cursor (K\_visible)

Exposed by Poll.

Properties:

- Always tx-closed.
- Always monotone component-wise.
- Never advances over a transaction not delivered.
- Conceptually distinct from K\_internal.

In Local v1 without active masking, K\_visible MAY numerically equal K\_internal, but remains conceptually filtered.

Direct exposure of K\_internal is forbidden.

---

## 2.2 Frontier Rule (Tx Boundary)

A cursor is admissible iff:

- It corresponds exactly to the end boundary of zero or more fully committed transactions.
- It does not lie strictly inside any transaction range.

Advancing to a non-boundary position is forbidden.

Violation: Critical.

---

## 2.3 Cursor Progression (Normative)

Given:

- K\_before
- Delivered transactions T1..Tn (ordered by tx\_index ordering)

Then:

1. Let T\_last be the last delivered transaction.
2. K\_after.metaSeq = max(K\_before.metaSeq, T\_last.metaSeqEnd)
3. K\_after.graphSeq = max(K\_before.graphSeq, T\_last.graphSeqEnd)
4. If no transaction delivered, K\_after = K\_before.

CursorAfter MUST be computed exclusively from delivered transactions.

It is forbidden to advance cursor based on raw read without delivery.

---

# 3. Transaction-Level Filtering (Pre-Mask Scaffold)

Filtering operates strictly at transaction level.

Event-level filtering is forbidden.

---

## 3.1 Normative Poll Algorithm (Tx-Index Driven)

```
function poll(graphSpaceId, fromCursor, limits):

  assertAdmissibleCursor(fromCursor)

  txCandidates = readTxIndexAfter(graphSpaceId, fromCursor)
    // ordered by canonical tx ordering

  deliveredTx = []

  for each txMeta in txCandidates:

      txBundle = readFullTransaction(graphSpaceId, txMeta.txId)

      if not isTransactionAdmissible(txBundle, fromCursor):
          continue

      if not isTransactionVisible(txBundle):
          continue

      // tx-level atomic delivery only
      if wouldBreakHardCap(deliveredTx, txBundle, limits):
          break

      deliveredTx.append(txBundle)

      if limitsReached(deliveredTx, limits):
          break

  metaOut  = flatten meta events from deliveredTx in seq order
  graphOut = flatten graph events from deliveredTx in seq order

  cursorAfter = computeCursorAfter(fromCursor, deliveredTx)

  return { meta: metaOut, graph: graphOut, cursorAfter }
```

---

## 3.2 Canonical Transaction Ordering

Transactions MUST be ordered by tx\_index according to:

- Primary key: minimum non-zero start sequence among (metaSeqStart, graphSeqStart)
- Secondary stable tie-breaker: txId

This ordering MUST be deterministic.

No implicit inter-stream total order is assumed beyond this transaction ordering.

---

## 3.3 Transaction Admissibility

A transaction is admissible iff:

1. All its events lie strictly after fromCursor in their respective streams.
2. It is fully readable (tx\_index boundary confirmed).

---

## 3.4 Transaction Visibility Rule (Scaffold)

For Local v1 (no principal filtering yet):

```
isTransactionVisible(tx) = true
```

However the structure MUST enforce:

- If any event of tx becomes masked in future principal filtering,
- Entire tx MUST be masked.

Partial transaction visibility is forbidden.

---

## 3.5 Cursor Advancement Rule

CursorAfter MUST be computed only from deliveredTx.

If a transaction is filtered out or masked:

- Cursor MUST NOT advance over it.

This preserves non-observability guarantees.

---

# 4. Interaction with INV-SYNC-1 to INV-SYNC-6

## INV-SYNC-1 — Scope by graphSpaceId

Poll MUST operate strictly within provided graphSpaceId namespace.

---

## INV-SYNC-2 — Non-alteration of Canon

Poll MUST NOT modify:

- EventEnvelope
- seq
- txId
- payload

Only grouping and filtering are allowed.

---

## INV-SYNC-3 — Monotone Cursors

cursorAfter MUST be:

- Component-wise monotone
- Tx-closed admissible

---

## INV-SYNC-4 — Intra-Transaction Order

Application order MUST be:

1. meta events
2. graph events

For each transaction.

---

## INV-SYNC-5 — Tolerance to Redelivery

Poll MAY return events already applied by consumer.

Consumer MUST deduplicate by eventId.

---

## INV-SYNC-6 — Idempotent Read

Repeated poll with same fromCursor and no new delivered transactions MUST:

- Return empty lists
- Return identical cursorAfter

---

# 5. Conformance Tests — Sync Layer (CT-S-\*)

## CT-S-1 — No Partial Transaction Cross-Stream (Critical)

Invariant targeted: tx-closed strict (cross-stream).

Procedure:

- Create transaction containing both meta and graph events.
- Poll with limits that would cut mid-transaction.
- Assert that both streams for that txId are delivered together.
- Assert no case where only meta or only graph of same txId is returned.

Oracle: B (Replay equivalence).

Risk: Critical.

---

## CT-S-2 — Cursor Monotone Strict (Critical)

Invariant targeted: INV-SYNC-3.

Procedure:

- Sequential polls across multiple transactions.
- Assert cursorAfter >= previous component-wise.
- Assert cursorAfter always matches tx boundary.

Oracle: A.

Risk: Critical.

---

## CT-S-3 — Pagination Determinism (Structural)

Invariant targeted: Determinism by replay.

Procedure:

- Poll in multiple pages.
- Apply incrementally.
- Compare state to CanonicalStateDump at final cursor.

Oracle: B.

Risk: Structural.

---

## CT-S-4 — Redelivery Safe (Critical)

Invariant targeted: INV-SYNC-5.

Procedure:

- Simulate duplicate delivery of same tx.
- Apply deduplication.
- Assert state unchanged.

Oracle: B.

Risk: Critical.

---

## CT-S-5 — Idempotent Read (Structural)

Invariant targeted: INV-SYNC-6.

Procedure:

- Call poll twice with same fromCursor and no new transactions.
- Assert identical empty result and identical cursorAfter.

Oracle: A.

Risk: Structural.

---

# 6. Implementation Risks

## 6.1 Critical Risks

- Transaction prefix exposed (cross-stream).
- Cursor advanced over filtered/masked transaction.
- Inconsistent tx\_index ordering.
- Meta/Graph order inverted within transaction.

---

## 6.2 Structural Risks

- Inefficient tx\_index scanning.
- Missing txId indexing preventing correct grouping.

---

## 6.3 Acceptable (MVP)

- Non-optimized performance.
- Lack of batching optimizations.

---

# Conclusion

Local Poll v1.1 is tx-index–driven, transaction-atomic, cursor-monotone, and structurally compatible with principal-filtered masking.

No partial transaction. No event-level filtering. No cursor drift. No canonical alteration.

---

## Source: principal_filtered_cursor_v1.md

# principal_filtered_cursor_v1.md

Version: 1.2  
Status: Normative  
Scope: Principal-filtered cursor + strict transaction masking

Compatible with:
- technical_execution_v_1.md (v1.1 consolidated)
- Sync_Poll_and_Cursor_Filtering_v1.md
- Sync_Transport_Layer_v1
- Security_Hardening_v1
- Conformance_Test_Model_v1

---

# 1️⃣ Modèle de curseur définitif

## 1.1 Modèle retenu

Le seul modèle de curseur exposé en surface Sync user-safe est numérique :

```
K_principal(P) = { metaSeq_visible: int, graphSeq_visible: int }
```

Il n’existe pas de token opaque dans cette spécification.

---

## 1.2 Propriétés normatives

Pour tout principal P :

1. Le curseur est monotone component-wise.
2. Il est toujours tx-closed.
3. Il n’avance que sur des transactions entièrement visibles pour P.
4. Il ne reflète jamais directement K_global.
5. Il ne permet pas d’inférer l’existence d’une transaction masquée.

Un curseur est admissible s’il correspond exactement à une frontière de transaction entièrement visible.

---

## 1.3 Règles d’utilisation

### Côté client

Le client MUST :

- Ne jamais inventer un curseur.
- Réutiliser uniquement :
  - le dernier cursorAfter reçu, ou
  - un curseur durablement persisté qui provient d’un cursorAfter antérieur.

### Côté serveur

Le serveur MUST :

- Valider l’admissibilité de fromCursor_principal via tx_index.
- Si le curseur n’est pas admissible :
  - Retourner une réponse non-révélatrice.
  - Ne fournir aucun détail structurel (txId, boundary hint, position interne).
  - La réponse MUST être shape-stable : même format, même catégorie d’erreur et même surface de métadonnées, indépendamment de la cause exacte de l’inadmissibilité.

---

# 2️⃣ Définitions formelles

## 2.1 Curseur global interne

```
K_global = (metaSeq, graphSeq)
```

Propriétés :
- Déterminé exclusivement par les heads EventStore.
- Toujours tx-closed.
- Jamais exposé user-safe.

---

# 3️⃣ Règle transaction masquée intégrale

## 3.1 Principe

Si une transaction T contient au moins un événement e tel que :

Pour au moins une référence r ∈ targetEntities(e),  
Authorize(P, actionLectureApplicable, r) = mask

Alors la transaction entière T est masquée pour P.

Aucune visibilité partielle n’est autorisée.

---

## 3.2 Définition normative des entités ciblées

Chaque EventEnvelope MUST exposer une liste canonique :

```
EventEnvelope.targetEntities: EntityRef[]
```

Définition :

```
targetEntities(e) = e.targetEntities
```

Contraintes :
- La liste MUST contenir toutes les EntityRef dont l’événement dépend ou qu’il modifie.
- La liste MUST être déterministe (même payload canonique → mêmes targetEntities).
- La liste MUST être conforme aux index EventStore « targetEntities ».

La transaction est visible si et seulement si :

Pour tout e ∈ T,  
Pour tout r ∈ targetEntities(e),  
Authorize(P, actionLectureApplicable, r) ≠ mask.

"actionLectureApplicable" désigne l’action effective utilisée par la Sync Layer pour exposer l’événement (read ou traverse selon le type).

---

# 4️⃣ Algorithme normatif (tx-index–driven)

 (tx-index–driven)

```
pollPrincipal(graphSpaceId, principal, fromCursor_principal, limits)
```

Précondition :
- fromCursor_principal MUST être admissible.

Algorithme :

```
assertAdmissiblePrincipalCursor(fromCursor_principal)

txCandidates = readTxIndexAfter(graphSpaceId, fromCursor_principal)
  // ordre transactionnel défini par :
  // 1) min(metaSeqStart, graphSeqStart) non nul
  // 2) txId comme tie-breaker stable

visibleTx = []

for each txMeta in txCandidates:

    txBundle = readFullTransaction(graphSpaceId, txMeta.txId)

    if not isFullyVisible(principal, txBundle):
        continue

    if wouldBreakHardCap(visibleTx, txBundle, limits):
        break

    visibleTx.append(txBundle)

    if limitsReached(visibleTx, limits):
        break

metaOut  = flatten meta events in canonical seq order
graphOut = flatten graph events in canonical seq order

cursorAfter = computePrincipalCursor(fromCursor_principal, visibleTx)

return { meta: metaOut, graph: graphOut, cursorAfter }
```

Aucun regroupement event-level n’est autorisé.

---

## 4.1 Calcul du curseur

```
if visibleTx empty:
    return fromCursor_principal

T_last = last(visibleTx)

return {
  metaSeq_visible  = max(fromCursor.metaSeq_visible,  T_last.metaSeqEnd),
  graphSeq_visible = max(fromCursor.graphSeq_visible, T_last.graphSeqEnd)
}
```

Il est interdit d’avancer le curseur au-delà des transactions livrées.

---

# 5️⃣ Cas limites critiques

## 5.1 Transaction partiellement masquée

Comportement : transaction entièrement ignorée.
Classification : Critical.

---

## 5.2 Transaction multi-stream

Livraison atomique meta + graph.
Classification : Critical.

---

## 5.3 Pagination coupant une transaction

Extension obligatoire jusqu’à frontière tx.
Classification : Critical.

---

## 5.4 Changement de permissions avant livraison

- Visibilité évaluée au moment de l’émission.
- Si transaction devient masquée → non livrée.
- Curseur ne progresse pas.

Classification : Critical.

---

## 5.5 Changement de permissions et cache projection

Tout changement de permissions effectives MUST invalider toute projection ou cache associé au principal.

Classification : Critical.

---

# 6️⃣ Conformance Tests — Security Critical

## CT-SH-1 — Absent vs Masked indistinguishable
Oracle : D  
Classification : Critical.

---

## CT-SH-2 — Transaction masquée ne progresse pas curseur
Oracle : A + B  
Classification : Critical.

---

## CT-SH-3 — Pagination sans trou observable
Oracle : D  
Classification : Critical.

---

## CT-SH-4 — Permission change invalide projection et cursor
Oracle : C + D  
Classification : Critical.

---

## CT-SH-5 — Replay déterministe par principal
Oracle : B  
Classification : Critical.

---

# 7️⃣ Interaction Projection

ProjectionEngine MUST :

- Utiliser exclusivement K_principal.
- Ne jamais comparer avec K_global.
- Ne jamais supposer la complétude globale.
- Ne jamais partager de cache entre principaux.

---

# 8️⃣ Risques d’implémentation

## Critical

- Cursor avance sur transaction masquée.
- Transaction partielle visible.
- Cache cross-principal.
- Trou observable.

---

## Structural

- Mauvais ordre transactionnel.
- Mauvais grouping txId.
- Pagination incorrecte.

---

## Acceptable

- Performance non optimisée.

---

# Conclusion

Le curseur filtré par principal est un tuple numérique tx-closed, monotone et non-fuyant.

Il n’existe aucune dualité tuple/token.
Aucune transaction partiellement visible.
Aucune dépendance au curseur global interne.

Violation = Security Critical.

---

## Source: projection_cache_scoped_by_principal_v1.md

# Projection Cache Scoped by Principal v1

Version: 1.0  
Status: Normative  
Scope: Projection cache isolation, invalidation, and security scoping

Compatible with:
- technical_execution_v_1.md (v1.1 consolidated)
- Sync_Poll_and_Cursor_Filtering_v1.md
- principal_filtered_cursor_v1.md
- Security_Hardening_v1
- Conformance_Test_Model_v1

---

# 1️⃣ Problème structurel

## 1.1 Définition formelle

Toute projection est définie comme :

```
Projection = f(EventStream_filtered(K_principal), LogicalSnapshot)
```

Où :

- `EventStream_filtered(K_principal)` = ensemble des transactions entièrement visibles pour un principal donné, jusqu’au curseur filtré `K_principal`.
- `LogicalSnapshot` = état logique (MetaState + contraintes + contexte) à une référence explicite.

Deux principaux distincts P1 et P2 peuvent avoir :

- des `EventStream_filtered` différents (transaction masquée intégrale),
- des `K_principal` différents,
- des ensembles d’entités visibles différents,
- des Derived et Placeholder différents.

## 1.2 Conclusion normative

Il est interdit de partager un ProjectionCache entre deux principaux dont les permissions effectives diffèrent.

Tout partage cross-principal constitue une violation Security Critical.

---

# 2️⃣ Clé de cache normative minimale

## 2.1 Définition

La clé logique minimale DOIT être :

```
CacheKey = (
  graphSpaceId,
  principalVisibilityHash,
  projectionSpecId,
  logicalSnapshotRef,
  K_principal
)
```

## 2.2 Contraintes normatives

1. `principalVisibilityHash` DOIT représenter les permissions effectives évaluées pour le principal (allow | deny | mask), de manière stable et déterministe.

   Il DOIT changer si et seulement si la fonction effective `Authorize` (pour les actions read / traverse utilisées par la Sync Layer et la Projection) change de résultat pour au moins une cible potentielle.

   Il DOIT intégrer l’effet du principe deny-wins et du masking transactionnel.
2. Deux principaux distincts avec politiques différentes DOIVENT produire des `principalVisibilityHash` distincts.
3. `K_principal` DOIT être le curseur filtré exposé à ce principal.
4. `K_global` NE DOIT JAMAIS être utilisé dans la clé.
5. Toute omission d’un des composants rend la clé non conforme.

## 2.3 Équivalence stricte

Deux CacheKey sont équivalentes si et seulement si tous les composants sont strictement égaux.

---

# 3️⃣ Règles d’invalidation obligatoires

Un ProjectionCache DOIT être invalidé immédiatement si l’un des éléments suivants change :

1. `K_principal`.
2. `principalVisibilityHash`.
3. `logicalSnapshotRef`.
4. `projectionSpecId`.
5. `graphSpaceId`.
6. `InvalidationReason` explicite (ex: refactor impactant visibilité, changement de règles de Derived).

## 3.1 Correspondance stricte CacheKey ↔ K_principal

Un cache matérialisé pour un `K_principal = K` ne peut servir que des requêtes correspondant exactement à ce même `K`.

Il est interdit de :

- répondre à une requête pour `K` à partir d’un cache calculé pour `K' > K`.
- réutiliser un cache cross-principal.
- adapter un cache existant par suppression post-traitement d’entités masquées.

L’implémentation incrémentale (delta) est autorisée à condition que :

- chaque nouvel état matérialisé corresponde à une nouvelle valeur exacte de `K_principal`,
- la cohérence soit strictement équivalente à un rebuild complet à ce même `K_principal`.

Toute reconstruction DOIT être réalisée à partir de `EventStream_filtered(K_principal)`.

---

# 4️⃣ Placeholder & Derived sous mask

## 4.1 Entité devenant masquée

Si une entité visible au moment du build devient masquée (changement de permissions) :

- la projection DOIT être reconstruite.
- aucun Derived dépendant de cette entité ne DOIT subsister.

## 4.2 Derived non révélateur

Un Derived ne DOIT jamais conserver :

- une dépendance révélatrice vers une entité masquée,
- une cardinalité indirectement révélatrice,
- une structure permettant d’inférer l’existence d’une entité masquée.

Si une entité dont dépend un Derived devient masquée, alors :

- le Derived DOIT être traité selon une stratégie unique et stable :
  - soit supprimé (absent),
  - soit remplacé par un Placeholder non révélateur.

La stratégie choisie DOIT être indépendante du contenu masqué et identique pour tous les principaux soumis aux mêmes règles de visibilité.

Violation = Security Critical.

## 4.3 Placeholder

Un Placeholder DOIT :

- ne jamais exposer de GraphID brut,
- ne jamais exposer d’EntityRef canonique,
- rester conforme au protocole d’Inspection Ontologique.

---

# 5️⃣ Interaction avec principal_filtered_cursor_v1

ProjectionEngine MUST :

1. Consommer exclusivement des transactions visibles.
2. Utiliser uniquement `K_principal` en surface user-safe.
3. Ne jamais exposer `K_global` en surface user-safe.
4. Ne jamais comparer `K_principal` à un curseur global interne pour produire un résultat user-safe.
5. Respecter strictement le grouping transactionnel.

## 5.1 Distinction user-safe / admin-safe

En surface user-safe :

- Il est interdit d’utiliser `K_global`.
- Il est interdit d’exposer un cache construit à partir d’un EventStream non filtré.

En surface admin-safe (diagnostic / audit contrôlé) :

- Un artefact distinct MAY utiliser `K_global`.
- Cet artefact DOIT être isolé logiquement et physiquement des caches user-safe.
- Il DOIT être soumis à un contrôle d’accès explicite et journalisé.
- Il NE DOIT JAMAIS être servi à un principal non autorisé.

Tout contournement du filtrage transactionnel en surface user-safe est interdit.

---

# 6️⃣ Cas limites critiques

## 6.1 Changement de permissions post-cache-build

Comportement normatif :

- recalcul complet de la projection.
- nouveau `principalVisibilityHash`.
- ancien cache invalide.

Classification : Critical.

---

## 6.2 Refactor type impactant visibilité

Si un refactor Meta modifie les règles d’accès ou les dépendances d’un Derived :

- invalidation obligatoire.
- rebuild complet.

Classification : Structural.

---

## 6.3 Snapshot rebuild vs incremental update

Rebuild complet et mise à jour incrémentale DOIVENT produire un état normalisé identique pour un principal donné.

Oracle : B (Replay) + C (Projection).

Classification : Critical.

---

## 6.4 ProjectionSpec évolutif

Tout changement de `projectionSpecId` DOIT produire une clé distincte.

Il est interdit de réutiliser un cache d’une ancienne version.

Classification : Structural.

---

## 6.5 Deux principaux avec même visibilité mais IDs différents

Si et seulement si `principalVisibilityHash` est strictement identique :

- le cache MAY être partagé.

Sinon :

- partage interdit.

Classification : Structural.

---

# 7️⃣ Conformance Tests — Security Cache (CT-PC-*)

## CT-PC-1 — Cache A jamais servi à principal B

Invariant ciblé : absence de cache cross-principal.  
Oracle : D.  
Classification : Critical.

---

## CT-PC-2 — Permission change invalide cache

Invariant ciblé : invalidation sur changement de visibilité.  
Oracle : C + D.  
Classification : Critical.

---

## CT-PC-3 — Derived masqué disparaît

Invariant ciblé : absence de dépendance révélatrice.  
Oracle : C.  
Classification : Critical.

---

## CT-PC-4 — Placeholder non révélateur

Invariant ciblé : non exposition de GraphID.  
Oracle : D.  
Classification : Critical.

---

## CT-PC-5 — Rebuild complet == delta incremental (par principal)

Invariant ciblé : déterminisme conditionnel par principal.  
Oracle : B + C.  
Classification : Critical.

---

# 8️⃣ Risques d’implémentation

## Critical

- Cache cross-principal.
- Cache non invalidé après changement de permissions.
- Comparaison implicite avec `K_global`.
- Fuite via Derived structure.
- Placeholder révélateur.

---

## Structural

- Mauvaise génération de `principalVisibilityHash`.
- Invalidation incorrecte sur changement de `logicalSnapshotRef`.
- Mauvais calcul de clé.

---

## Acceptable

- Performance sous-optimale.
- Absence de stratégie LRU sophistiquée.

---

# Conclusion normative

Un ProjectionCache est un artefact dérivé strictement scoped par principal.

Il ne constitue jamais une source de vérité.
Il ne peut être partagé que si la visibilité effective est strictement identique.
Il est invalidable à tout moment.

Toute violation de ces règles constitue une faille Security Critical.

---

## Source: sync_subscribe_best_effort_v1.md

# Sync Subscribe — Best Effort v1

Version: 1.0\
Status: Normative\
Scope: Subscribe best-effort, transaction buffering, redelivery tolerance, poll fallback, non-leak under mask

---

# 1️⃣ Positionnement normatif

## 1.1 Subscribe ≠ vérité

Subscribe est un mécanisme **best-effort**.

Poll est la **source de vérité**.

Subscribe :

- NE DOIT PAS être considéré comme autoritatif.
- NE DOIT JAMAIS produire un état plus avancé ou plus fiable que Poll.
- NE DOIT JAMAIS permettre d’observer un état non admissible (tx-closed + filtré par principal).

Une vue est cohérente uniquement si :

- son curseur est un `K_principal` admissible,
- toutes les transactions appliquées sont tx-closed,
- aucune transaction partiellement visible n’a été délivrée.

En cas d’écart, de doute ou d’incohérence → fallback Poll obligatoire.

---

# 2️⃣ Contrat Subscribe minimal

## 2.1 Signature normative

```
subscribe(graphSpaceId, fromCursor = K_principal)
```

Où :

- `fromCursor` MUST être un curseur filtré par principal admissible.
- Subscribe opère dans le scope strict de `graphSpaceId`.

## 2.2 Sémantique de livraison

Subscribe est **at-least-once** :

- Redelivery possible.
- Déconnexions possibles.
- Répétitions possibles.

Subscribe MAY livrer des transactions dans un ordre différent de l’ordre d’émission (transport hors-scope), mais **chaque unité livrée MUST rester tx-closed**.

## 2.3 Unité de livraison (tx-closed obligatoire)

L’unité minimale de livraison en Subscribe est une **transaction complète**.

Chaque message Subscribe MUST représenter exactement **un** `txId` et MUST être tx-closed :

- si `metaEvents` est présent : il contient **tous** les meta events de ce `txId` visibles pour le principal,
- si `graphEvents` est présent : il contient **tous** les graph events de ce `txId` visibles pour le principal,
- si un `txId` comporte des events dans les deux streams, alors la livraison MUST être atomique (meta + graph) dans le même message.

Le message MUST inclure :

- `graphSpaceId`
- `txId`
- `cursorBefore` (K\_principal)
- `cursorAfter` (K\_principal)
- `metaEvents[]?` (EventEnvelope)
- `graphEvents[]?` (EventEnvelope)

Contraintes :

- `cursorAfter` MUST être admissible (tx-closed) et monotone component-wise.
- `cursorAfter` MUST être calculé exclusivement à partir de transactions **effectivement livrées**.
- `cursorBefore` MUST correspondre au `K_principal` connu du serveur pour cette session de Subscribe ; tout mismatch côté client déclenche fallback Poll.
- Il est interdit d’émettre un message Subscribe tel que :
  - `metaEvents` et `graphEvents` soient tous deux vides, ET
  - `cursorAfter` soit strictement supérieur à `cursorBefore`.

Autrement dit :

> Si aucune transaction visible n’est livrée, aucun delta ne DOIT être émis.

Violation = Critical.

---

# 3️⃣ Buffering de redelivery (sans heuristique de complétude)

Subscribe étant at-least-once, le runtime/client MUST tolérer la redelivery.

## 3.1 Principe

Le buffering côté client sert uniquement à :

- dédupliquer (par `eventId`),
- reconstituer l’ordre d’application si des messages sont rejoués,
- éviter tout double-apply.

Il MUST NOT servir à déterminer la frontière transactionnelle.

## 3.2 Structure minimale recommandée

```
TxSeen[txId] = {
  seenEventIds: Set<EventId>,
  applied: boolean
}
```

## 3.3 Règle fondamentale

Le runtime/client MUST appliquer à la couche projection uniquement des messages Subscribe déjà tx-closed.

Toute incertitude (mismatch, gap, redelivery ambiguë) → fallback Poll.

---

# 4️⃣ Couplage strict Subscribe → Poll (Self-Healing)

Subscribe n’est valide que couplé à Poll.

## 4.1 Triggers normatifs de fallback Poll

Le runtime/client MUST déclencher un fallback Poll (recovery) si l’un des signaux suivants est observé.

### T-SS-POLL-1 — Cursor mismatch (Critical)

- Condition : `delta.cursorBefore != localK_principal`.
- Action : abandonner la progression via Subscribe et exécuter `poll(graphSpaceId, fromCursor = localK_principal)`.

Aucune tentative de “rattrapage” par heuristique n’est autorisée.

### T-SS-POLL-2 — CursorAfter non admissible ou non monotone (Critical)

- Condition : `delta.cursorAfter` n’est pas admissible tx-closed, ou n’est pas monotone component-wise par rapport à `delta.cursorBefore`.
- Action : fallback Poll depuis le dernier `K_principal` durablement appliqué.

### T-SS-POLL-3 — Redelivery ambiguë / double-apply non résoluble (Critical)

- Condition : le runtime/client ne peut garantir l’absence de double-apply malgré la déduplication (ex. état local incertain après crash/reload, ou incohérence interne détectée).
- Action : fallback Poll depuis le dernier `K_principal` durablement appliqué.

### T-SS-POLL-4 — Permission / visibilité modifiée (Critical)

- Condition : changement de `principalVisibilityHash` (ou signal équivalent) impliquant un changement effectif de `Authorize`.
- Action :
  1. invalider toutes projections/caches user-safe associés au principal,
  2. réinitialiser la session Subscribe,
  3. fallback Poll depuis le dernier `K_principal` durablement appliqué.

### T-SS-POLL-5 — Invalidation projection requise (Structural/Critical selon cause)

- Condition : changement de `projectionSpecId` ou `logicalSnapshotRef` (ou invalidation explicite).
- Action : invalider/rebuild selon Projection Cache Contract, et utiliser Poll comme mécanisme de rattrapage si la continuité Subscribe ne peut être garantie.

## 4.2 Règle de reprise

Poll MUST reprendre depuis :

- le dernier `K_principal` durablement appliqué (persisté),
- jamais depuis un curseur supposé.

Subscribe ne peut pas corriger Poll. Poll corrige Subscribe.

---

# 5️⃣ Curseurs et progression

## 5.1 Règles strictes

Le curseur local appliqué MUST être `K_principal`.

Subscribe peut faire progresser `K_principal` uniquement si :

- transaction complète,
- transaction visible,
- transaction appliquée à la projection,
- transaction conforme à l’ordre tx-index.

## 5.2 Transaction masquée

Si un `txId` existe globalement mais est masqué :

- Il est indistinguable d’un `txId` absent.
- Il ne contribue pas au curseur.
- Il ne crée aucun trou observable.

## 5.3 Interdictions

Il est interdit :

- d’ack une transaction non appliquée,
- d’exposer un trou de séquence,
- d’avancer le curseur au-delà des transactions effectivement livrées.

Violation = Security Critical.

---

# 6️⃣ Sécurité non-fuyante sous mask

Subscribe DOIT respecter :

- Transaction masquée intégrale.
- Absent vs masked indistinguable.
- Aucun signal différentiel.

## 6.1 Comportement obligatoire

Si un txId existe mais est masqué :

Subscribe DOIT se comporter comme si ce txId n’existait pas.

Aucun des éléments suivants ne DOIT varier :

- progression du curseur,
- forme des deltas,
- erreurs,
- timing structurel (dans les bornes raisonnables d’implémentation).

## 6.2 Interdictions

Aucune fuite via :

- delta shape,
- taille message,
- progression seq,
- redelivery pattern,
- erreurs différenciées.

Violation = Security Critical.

---

# 7️⃣ Interaction avec Projection Cache

## 7.1 Scoping obligatoire (CacheKey)

Tout calcul ou mise à jour de projection déclenché par Subscribe MUST être scoped par la clé :

```
CacheKey = (
  graphSpaceId,
  principalVisibilityHash,
  projectionSpecId,
  logicalSnapshotRef,
  K_principal
)
```

Contraintes :

- `principalVisibilityHash` MUST représenter les permissions effectives du principal (deny-wins + mask inclus).
- `K_principal` MUST être le curseur filtré user-safe (jamais `K_global`).
- Toute mise à jour incrémentale (delta) est autorisée uniquement si elle est strictement équivalente à un rebuild complet au même `CacheKey`.

## 7.2 Règle d’application des deltas Subscribe

Avant d’appliquer une transaction livrée par Subscribe, le runtime MUST vérifier :

- que la projection active correspond exactement à un `CacheKey` construit avec le `K_principal` courant,
- que `principalVisibilityHash` associé à la projection est identique au `principalVisibilityHash` courant,
- que `projectionSpecId` et `logicalSnapshotRef` sont identiques à ceux de la projection active.

Si une de ces conditions échoue :

- le runtime MUST invalider le cache/projection,
- le runtime MUST effectuer un rebuild (ou ré-ouverture) au nouveau `CacheKey`,
- le runtime MUST utiliser Poll comme mécanisme de rattrapage si la continuité Subscribe ne peut être garantie.

Il est interdit d’appliquer un delta Subscribe sur une projection/caches calculés sous un autre `CacheKey`.

Violation = Security Critical.

## 7.3 Invalidation obligatoire

Subscribe MUST déclencher invalidation/rebuild si l’un des éléments suivants change :

1. `principalVisibilityHash`.
2. `projectionSpecId`.
3. `logicalSnapshotRef`.
4. `graphSpaceId`.

Pour `K_principal` :

- l’avancement de `K_principal` implique une nouvelle valeur de `CacheKey`.
- l’implémentation MAY appliquer des deltas tant que chaque état matérialisé correspond exactement au nouveau `K_principal` (et donc à un nouveau `CacheKey`).

## 7.4 Interdictions (anti-contamination)

Il est interdit :

- d’utiliser un cache construit sous un autre principal (cross-principal).
- d’utiliser un cache construit sous un autre `principalVisibilityHash`.
- de reconstruire un état global puis de supprimer des entités masquées en post-traitement.
- d’exposer, même indirectement, des diagnostics admin-safe via la voie user-safe (y compris via la Sync path).

---

# 8️⃣ Conformance Tests — Subscribe (CT-SS-\* ) (CT-SS-\* )

## CT-SS-1 — Redelivery idempotente (Critical)

Invariant : aucune double application.\
Oracle : B.

---

## CT-SS-2 — Transaction jamais partielle (Critical)

Invariant : tx-closed strict.\
Oracle : B.

---

## CT-SS-3 — Gap déclenche fallback Poll (Critical)

Invariant : self-healing correct.\
Oracle : A + B.

---

## CT-SS-4 — Curseur monotone (Critical)

Invariant : progression K\_principal monotone.\
Oracle : A.

---

## CT-SS-5 — Masqué vs absent indistinguable (Critical)

Invariant : non-fuite.\
Oracle : D.

---

## CT-SS-6 — Rebuild == incremental (Critical)

Invariant : déterminisme conditionnel par principal ; delta Subscribe équivalent à rebuild complet au même `CacheKey`.\
Oracle : B + C.

---

## CT-SS-7 — Invalidation CacheKey sur changement de visibilité (Critical)

Invariant : changement de `principalVisibilityHash` invalide cache/projection ; aucune application de delta sur ancien CacheKey.\
Oracle : C + D.

---

## CT-SS-8 — Interdiction d’application cross-principal via Subscribe (Critical)

Invariant : aucun cache/projection d’un principal A ne reçoit des deltas livrés pour un principal B.\
Oracle : D.

---

# 9️⃣ Risques d’implémentation

## Critical

- Transaction partielle appliquée.
- Curseur progresse sur transaction masquée.
- Cache cross-principal via subscribe.
- Delta révélateur.

## Structural

- Lifecycle buffer incorrect.
- Mauvaise gestion window.
- Ordre meta → graph mal appliqué.

## Acceptable

- Latence accrue due à fallback Poll fréquent.

---

# 🔒 Interdictions globales

- Pas de Remote backend.
- Pas de multi-writer.
- Pas de promesse exactly-once.
- Pas de UI.

---

# Conclusion

Subscribe v1 est un accélérateur opportuniste, jamais une source de vérité.

Il est strictement :

- transactionnel,
- tx-closed,
- filtré par principal,
- auto-correctible via Poll,
- non-fuyant sous mask,
- scoped par cache principal.

Toute violation est classifiée Security Critical.

---

## Source: remote_eventstore_execution_contract_v1.md

# Remote EventStore Execution Contract v1

Version: 1.0\
Status: Normative\
Scope: Remote = EventStore-compatible implementation contract + minimal execution interface + isolation rules + Conformance Gate (CT-R-\*)

Strictly compatible with:

- technical\_execution\_v\_1.md (v1.1 consolidated)
- Sync\_Poll\_and\_Cursor\_Filtering\_v1.md
- principal\_filtered\_cursor\_v1.md
- Projection\_Cache\_Scoped\_by\_Principal\_v1.md
- Sync\_Subscribe\_Best\_Effort\_v1.md
- Conformance\_Test\_Model\_v1
- Security\_Hardening\_v1
- Product Strategy v1 (Remote EventStore Contract requirement)

---

# 1️⃣ Normative Reminder — Remote = EventStore-Compatible (Non‑Negotiable)

A Remote backend is conformant v1 if and only if it behaves logically as an EventStore.

## 1.1 Append-Only Logical Model

The Remote backend MUST guarantee:

1. No UPDATE of a committed event.
2. No DELETE of a committed event.
3. Every canonical mutation is represented as the append of a new transaction.
4. Event payloads are immutable once committed.

Physical compaction MAY exist, but MUST preserve append-only logical semantics.

Violation classification: Critical.

---

## 1.2 tx-closed Strict (Commit-or-Nothing Observable)

For every `txId`:

1. All events belonging to the transaction MUST be written atomically.
2. No consumer MUST observe a prefix of a committed transaction.
3. No read API MUST expose a partially written transaction.
4. Visibility MUST be commit-or-nothing.

The Remote backend MUST rely on a database isolation level sufficient to prevent partial visibility.

Violation classification: Critical.

---

## 1.3 Two Streams, Total Order per Stream Only

The Remote backend MUST maintain:

- Stream `meta`
- Stream `graph`

Constraints:

1. Strictly monotonic `metaSeq` per graphSpaceId.
2. Strictly monotonic `graphSeq` per graphSpaceId.
3. No reuse of sequence numbers.
4. Unique index on `(graphSpaceId, stream, seq)`.

No total inter-stream ordering is required.

Violation classification: Critical.

---

## 1.4 Deterministic Replay

Given:

- An EventStream up to admissible cursor K
- A LogicalSnapshot reference

The reconstruction of MetaState and GraphState MUST be deterministic.

Snapshot + replay MUST produce an equivalent normalized state to full replay.

Violation classification: Critical.

---

## 1.5 Persistent Idempotence

The Remote backend MUST enforce uniqueness of:

```
(graphSpaceId, actorId, idempotencyKey)
```

Rules:

1. Same `(actorId, idempotencyKey, payloadHash)` → identical final result (receipt or error).
2. Same `(actorId, idempotencyKey)` with different payload → rejected.
3. Idempotency result MUST survive crash/restart.

Idempotency write and event append MUST be atomic.

Violation classification: Critical.

---

## 1.6 No Canonical CRUD

It is forbidden to expose:

- Direct UPDATE/DELETE of canonical state.
- Arbitrary state store writes bypassing appendTx.

All canonical mutations MUST flow through:

Command → Kernel → Transaction → EventStore → Receipt

Violation classification: Critical.

---

# 2️⃣ Remote Execution Interface (Transport-Agnostic)

The following conceptual interface is normative. Transport (HTTP, RPC, etc.) is out of scope.

---

## 2.1 appendTx

```
appendTx(graphSpaceId, txBundle, idempotencyCtx) -> receipt | error
```

Requirements:

1. Atomic multi-table write.
2. Monotonic seq allocation per stream.
3. tx-closed visibility.
4. Idempotency enforced persistently.
5. Receipt includes admissible `cursorAfter`.

`cursorAfter` MUST be tx-closed and monotone.

Violation classification: Critical.

---

## 2.2 readRange

```
readRange(graphSpaceId, stream, fromSeqExclusive, limit, mode=TX_CLOSED)
  -> EventEnvelope[]
```

Normative behavior:

1. MUST respect per-stream ordering.
2. MUST NOT return partial transactions.
3. If `limit` cuts inside a transaction, the backend MUST extend the result to include the full transaction.
4. MUST NOT reject in a way revealing internal structure.

Violation classification: Critical.

---

## 2.3 readTx

```
readTx(graphSpaceId, txId) -> TxBundle | null
```

Requirements:

1. MUST return the full transaction.
2. MUST preserve meta → graph intra-transaction order.

Violation classification: Critical.

---

## 2.4 getCursorHead

```
getCursorHead(graphSpaceId) -> Cursor
```

Returns the canonical **internal** head `(metaSeq, graphSeq)`.

Normative constraints:

1. This value corresponds to the internal global cursor (`K_global`) maintained by the EventStore.
2. It MUST NOT be exposed on any user-safe surface.
3. If the Remote backend provides this endpoint at all, it MUST be restricted to admin-safe diagnostics only.

User-safe consumers MUST use only principal-filtered cursors (via `poll` and/or `subscribe`).

---

## 2.5 resolveRevision (Optional but Normative if Implemented)

```
resolveRevision(graphSpaceId, revisionToken) -> Cursor | null
```

Requirements:

1. The resolved cursor MUST be tx-closed admissible.
2. Resolution MUST be non-revealing under mask.
3. In user-safe surfaces, the following cases MUST be indistinguishable:
   - revision unknown,
   - revision masked,
   - revision not authorized,
   - revision belonging to another scope.

User-safe error contract (normative alignment with Overlay + Product Strategy):

- The external category MUST be:

  PRECONDITION.CURSOR\_MISMATCH

  (or strictly equivalent generic PRECONDITION error), and MUST NOT differentiate the underlying cause.

It is forbidden in user-safe surfaces to return:

- revision-specific NOT\_FOUND,
- PERMISSION revealing existence,
- any structural diagnostic.

Admin-safe surfaces MAY expose detailed diagnostics (e.g. masked=true), under strict access control and logging.

Violation classification: Critical if implemented incorrectly.

---

## 2.6 poll (Authoritative Sync)

```
poll(graphSpaceId, fromCursor) -> {
  meta: EventEnvelope[],
  graph: EventEnvelope[],
  cursorAfter: Cursor
}
```

Normative constraints:

1. Poll is the authoritative recovery and synchronization mechanism.
2. Poll MUST be driven by transaction boundaries (`tx_index`), not by independent per-stream range reads.
3. Poll MUST be tx-closed strict across both streams:
   - Never return a partial transaction.
   - Never expose a prefix of a transaction in any stream.
   - If a transaction contains events in both streams, delivery MUST be atomic across both streams.
4. `fromCursor` MUST be admissible (tx boundary). If not admissible, the backend MUST return a single non-revealing failure outcome and MUST NOT attempt mid-transaction recovery.
5. `cursorAfter` MUST be computed only from transactions actually delivered.
6. `cursorAfter` MUST be monotone component-wise.

User-safe semantics:

- The cursor exposed to a client MUST be principal-filtered (`K_principal`), never `K_global`.
- Masking and filtering MUST operate at transaction level.

Violation classification: Critical.

---

## 2.7 subscribe (Optional — Best Effort)

```
subscribe(graphSpaceId, fromCursor) -> stream of tx-closed messages
```

Requirements:

1. At-least-once.
2. Delivery unit = full transaction.
3. No partial transaction.
4. No advancement beyond delivered transactions.
5. Poll fallback mandatory on mismatch.

Violation classification: Critical.

---

# 3️⃣ Minimal Logical Storage & Indexing Requirements

No specific database technology is mandated. Logical constraints are mandatory.

---

## 3.1 Required Logical Structures

### events (immutable)

Fields:

- graphSpaceId
- stream (`meta` | `graph`)
- seq
- txId
- eventId
- payload

Indexes (mandatory):

- UNIQUE(graphSpaceId, stream, seq)
- INDEX(graphSpaceId, txId)

---

### tx\_index (derived, non-authoritative)

Fields:

- graphSpaceId
- txId
- metaSeqStart/metaSeqEnd
- graphSeqStart/graphSeqEnd

Purpose:

- Boundary detection
- tx-closed enforcement

Normative constraints:

1. `tx_index` MUST be derivable from the immutable event streams.
2. `tx_index` MUST NOT be treated as an independent source of truth.
3. If `tx_index` becomes inconsistent with the underlying event streams, the implementation MUST fail safely (corruption) and MUST NOT silently reconstruct an alternative history.

Event log remains sole authority.

---

### commands\_idempotency

Fields:

- graphSpaceId
- actorId
- idempotencyKey
- payloadHash
- result

Index (mandatory):

- UNIQUE(graphSpaceId, actorId, idempotencyKey)

---

## 3.2 Atomic Multi-Table Write

All writes for a transaction MUST occur within a single database transaction:

- events inserts
- tx\_index insert
- head update
- idempotency write

Partial persistence is forbidden.

Violation classification: Critical.

---

# 4️⃣ Security & Non-Leak Guarantees (Remote)

---

## 4.1 No Unfiltered Exposure

The Remote backend MUST NOT expose raw unfiltered events directly to clients.

All user-safe exposure MUST pass through:

- principal filtering
- transaction-level masking
- deny-wins logic

---

## 4.2 Principal-Filtered Cursor

User-safe cursor MUST be:

```
K_principal = (metaSeq_visible, graphSeq_visible)
```

Requirements:

1. Monotone.
2. tx-closed.
3. Advances only over fully visible transactions.
4. Must not reveal masked transactions.

Global cursor MUST NOT be exposed user-safe.

Violation classification: Security Critical.

---

## 4.3 Transaction-Level Masking

If any event within a transaction is masked for principal P:

→ Entire transaction MUST be masked.

No partial visibility allowed.

Violation classification: Security Critical.

---

## 4.4 Projection Cache Isolation

Remote serving projections MUST respect:

- principal-scoped cache keys
- no cross-principal reuse
- rebuild on visibility change

Violation classification: Security Critical.

---

# 5️⃣ Conformance Gate — CT-R-\* (Blocking in CI)

All tests below are Critical.

Failure of any test = backend non-conformant v1.

---

## CT-R-1 — Append-Only Strict

Invariant: No mutation post-commit.

Oracle: B (Replay / CanonicalStateDump equivalence).

Test (minimum):

- Append at least one transaction.
- Attempt any operation that would mutate or delete a committed event.
- Assert mutation is impossible by construction or rejected.
- Assert replay equivalence remains valid.

Classification: Critical.

---

## CT-R-2 — tx-closed Strict (readRange)

Invariant: No prefix of transaction on range reads.

Oracle: B.

Test (minimum):

- Append a transaction with multiple events in the chosen stream.
- Call `readRange` with a `limit` that would cut inside that transaction.
- Assert the response includes the full transaction (extension to tx boundary).
- Assert no distinguishable error shape exists that reveals boundary cuts.

Classification: Critical.

---

## CT-R-3 — Deterministic Replay

Invariant: Determinism by replay at identical admissible cursor.

Oracle: B.

Test (minimum):

- Obtain CanonicalStateDump after full replay to cursor K.
- If snapshots are supported: rebuild from snapshot+replay to the same K.
- Assert normalized dumps are equal.

Classification: Critical.

---

## CT-R-4 — Idempotence Strict

Invariant: Same `(graphSpaceId, actorId, idempotencyKey, payloadHash)` yields identical final outcome.

Oracle: A (Receipt/Error equality).

Test (minimum):

- Call `appendTx` twice with identical `idempotencyCtx` and logically identical txBundle.
- Assert the second call returns exactly the same final outcome shape and content (receipt or error) as the first.
- Call again with same key but different payloadHash.
- Assert rejection (conflict) and no state change.

Classification: Critical.

---

## CT-R-5 — Cursor Monotone & Admissible

Invariant: Cursor is tx-closed admissible and monotone.

Oracle: A.

Test (minimum):

- Poll repeatedly across multiple transactions.
- Assert `cursorAfter` is always a tx boundary.
- Assert `cursorAfter` is monotone component-wise.
- Assert `cursorAfter` is computed only from delivered transactions.

Classification: Critical.

---

## CT-R-6 — Mask + Sync Indistinguishable

Invariant: Absent vs masked indistinguishable on user-safe surfaces.

Oracle: D (Security indistinguishability).

Test (minimum):

- Fixture A: a transaction does not exist.
- Fixture B: an identical-shaped situation except the transaction exists globally but is fully masked for the principal.
- Compare user-safe observables:
  - delivered deltas
  - cursor progression
  - error category/shape
- Assert indistinguishability.

Classification: Critical.

---

## CT-R-7 — No Cross-Principal Cache

Invariant: No projection/cache reuse across principals with different effective visibility.

Oracle: C + D.

Test (minimum):

- Build projection/cache for principal P1.
- Attempt to serve the same cached artifact to principal P2 with different effective visibility.
- Assert forbidden (hard failure) or provably impossible by cache keying.

Classification: Critical.

---

# 6️⃣ Product Activation Policy (Gating)

Remote mode MUST remain disabled until:

1. All CT-R-\* tests pass in CI.
2. No Security Critical violation is open.
3. Replay determinism validated under load.

Remote conformity is an entry condition, not optional.

---

# 7️⃣ Implementation Risks

## Critical Risks

- Insufficient DB isolation (partial tx visibility).
- Non-atomic idempotency write.
- Sequence gaps or reuse.
- Cursor advancement over masked transaction.
- Leak via global cursor.

---

## Structural Risks

- Inefficient tx-closed range extension.
- Contention on sequence allocation.
- Incorrect tx ordering in poll.

---

## Acceptable (MVP)

- No advanced performance optimizations.
- No multi-writer.
- No merge.

---

# Final Normative Statement

A Remote backend is conformant v1 if and only if:

- It behaves indistinguishably from a strict EventStore.
- It preserves tx-closed atomicity.
- It guarantees deterministic replay.
- It enforces persistent idempotence.
- It prevents any mask-related leakage.
- It passes the full CT-R-\* Conformance Gate.

Violation of any Critical invariant renders the backend non-conformant v1.

---

## Source: overlay_mask_edge_cases_v1.md

# Overlay Mask Edge Cases v1

Version: 1.0  
Status: Normative  
Scope: Overlay commit security, resolveRevision non-révélateur, entityIdMap, lock masking, idempotency under mask

Strictement compatible avec :
- technical_execution_v_1.md (v1.1 consolidé)
- principal_filtered_cursor_v1.md
- projection_cache_scoped_by_principal_v1.md
- sync_poll_and_cursor_filtering_v_1.md
- sync_subscribe_best_effort_v1.md
- remote_eventstore_execution_contract_v1.md
- Security_Hardening_v1
- Conformance_Test_Model_v1

---

# 1️⃣ Overlay Commit + Mask Interaction

## 1.1 Principe fondamental

Si une entité ciblée par un Overlay (DeltaSet) est masquée pour un principal P :

→ Le résultat user-safe DOIT être strictement indistinguable d’un NOT_FOUND.

Aucune surface user-safe ne DOIT permettre d’inférer :
- l’existence réelle de l’entité,
- l’existence d’un lock,
- l’existence d’une divergence de révision,
- l’existence d’une transaction partiellement autorisée.

## 1.2 Interdictions strictes

Il est interdit :

1. D’émettre un commit partiel (subset de deltas appliqués).
2. De produire un entityIdMap partiel.
3. D’avancer le curseur visible en cas de rejet.
4. De différencier via reasonCode user-safe un cas "absent" d’un cas "masqué".
5. De produire un comportement temporel structurellement distinct (progression de cursorAfter, forme de receipt, delta Subscribe).

Violation = Security Critical.

---

# 2️⃣ entityIdMap Security Contract

## 2.1 Exhaustivité

Si le commit est accepté :

- entityIdMap MUST contenir toutes les correspondances tempId → realId pour les entités créées et visibles.
- Aucune entité créée visible ne peut être omise.

## 2.2 Non-révélation

entityIdMap MUST NOT contenir :
- une entrée relative à une entité masquée,
- un placeholder implicite révélant une tentative.

Si le commit est rejeté (PERMISSION.mask ou équivalent non révélateur) :

- entityIdMap MUST être absent ou vide.
- Aucun mapping partiel n’est autorisé.

## 2.3 Référence masquée → rejet intégral

Si un DeltaSet référence une entité masquée (directement ou via endpoints d’edge) :

- la Command DOIT être rejetée intégralement,
- la surface user-safe DOIT être indistinguable d’un NOT_FOUND.

Aucun event ne DOIT être commité.

## 2.4 Retry idempotent

Si une Command avec idempotencyKey est rejouée :

- Le résultat retourné MUST être identique (receipt ou erreur), bit-équivalent après normalisation.
- entityIdMap MUST être strictement identique au résultat initial.

## 2.5 Mask tardif

Si :
1. Un commit a réussi.
2. Les permissions changent ultérieurement.
3. Une retry idempotente survient.

Alors :
- Le résultat retourné MUST être identique au résultat initial.
- Il est interdit de recalculer entityIdMap selon les nouvelles permissions.

## 2.6 TempId collision et inférence

Un acteur malveillant pourrait tenter d’inférer l’existence d’une entité masquée via :
- collisions de tempId,
- différences de traitement “déjà existant” vs “créé”,
- erreurs différenciées selon la cause.

Règles normatives :

1. Les tempId sont strictement locaux à l’overlay et n’ont aucune signification canonique.
2. Toute collision ou incohérence interne de tempId DOIT produire une erreur user-safe non révélatrice (shape-stable), sans exposer la cause exacte.
3. Il est interdit qu’un mapping partiel (succès sur certains tempId) permette d’inférer qu’un autre tempId correspondait à une cible masquée.

Violation = Security Critical.

---

# 3️⃣ resolveRevision Non-Révélateur (Overlay Path)
 Non-Révélateur (Overlay Path)

## 3.1 Cas indifférenciables (user-safe)

Les cas suivants DOIVENT être indistinguables :

1. Révision inexistante.
2. Révision existante mais masquée.
3. Révision hors-scope.
4. Révision appartenant à un autre graphSpaceId.

Surface user-safe :
- Catégorie générique PRECONDITION.CURSOR_MISMATCH (ou équivalent strictement neutre).
- Aucune indication supplémentaire.

## 3.2 Surface admin-safe

En surface admin-safe contrôlée :

- masked=true MAY être exposé.
- Diagnostics internes MAY être exposés.
- Accès journalisé obligatoire.

Violation = Security Critical si fuite user-safe.

---

# 4️⃣ Locks sous Mask

## 4.1 Règle non-révélatrice (user-safe)

Si une Command cible une entité masquée, **toute** réponse user-safe DOIT rester indistinguable d’un NOT_FOUND (mask ⇒ NOT_FOUND user-safe).

Conséquence :

- Un lock existant sur une entité masquée NE DOIT JAMAIS être reflété en user-safe.
- Il est interdit de retourner `CMD.CONFLICT.LOCKED` en user-safe si la cible est masquée.

## 4.2 Règle de sélection d’erreur (alignement allow|deny|mask)

1. Si Authorize(P, …) = mask pour au moins une cible → user-safe = NOT_FOUND générique.
2. Sinon (cibles non masquées) et acquisition lock échoue → user-safe = CONFLICT / `CMD.CONFLICT.LOCKED` avec message générique “resource busy”, sans owner.

Il est interdit de produire une différence observable entre :
- cible absente,
- cible masquée,
- cible masquée et verrouillée.

## 4.3 Admin-safe

Surface restreinte MAY exposer :
- diagnostics lock,
- masked=true,
- owner interne,
- détails de contention.

Contrôle d’accès strict + audit obligatoire.

Violation = Security Critical.

---

# 5️⃣ Idempotency sous Mask


## 5.1 Cas critique

Scénario :

1. Command initiale commitée.
2. Permissions changent.
3. Retry avec même idempotencyKey.

## 5.2 Norme

Le résultat retourné DOIT être strictement identique au résultat initial :

- même category,
- même reasonCode,
- même entityIdMap,
- même cursorAfter,
- même structure receipt.

Il est interdit de recalculer selon permissions actuelles.

Toute divergence constitue une fuite temporelle.

Violation = Critical.

---

# 6️⃣ Conformance Tests — Overlay Security (CT-OM-*)

## CT-OM-1 — entityIdMap jamais révélateur
Invariant : aucun mapping partiel ou révélateur.  
Oracle : A + D  
Classification : Critical

## CT-OM-2 — resolveRevision absent vs masked indistinguishable
Invariant : non-révélation.  
Oracle : D  
Classification : Critical

## CT-OM-3 — Lock masqué non révélateur
Invariant : indistinguabilité absent/masked/locked.  
Oracle : D  
Classification : Critical

## CT-OM-4 — Retry idempotent sous permission change retourne même receipt
Invariant : stabilité temporelle.  
Oracle : A  
Classification : Critical

## CT-OM-5 — Commit overlay masqué ne progresse pas curseur visible
Invariant : K_principal non avancé.  
Oracle : A + B  
Classification : Critical

## CT-OM-6 — Aucun delta partiel observable en cas de rejet
Invariant : atomicité stricte.  
Oracle : A + D  
Classification : Critical

---

# 7️⃣ Risques d’Implémentation

## Critical

- entityIdMap partiel.
- resolveRevision révélateur.
- retry recalculé selon nouvelles permissions.
- commit partiel.
- fuite via lock error.
- progression curseur malgré rejet.

## Structural

- Mauvaise séparation user-safe / admin-safe.
- Mauvaise gestion overlay multi-session.
- Cache projection non invalidé après changement permissions.

## Acceptable (MVP)

- Friction UX liée à neutralité des erreurs.

---

# Verrou Final

Overlay commit, masking, idempotency et résolution de révision DOIVENT former un bloc cohérent non-fuyant.

Aucune transaction partielle.
Aucune réévaluation temporelle.
Aucune fuite via entityIdMap.
Aucune différenciation absent vs masqué.

Violation = Security Critical.

---

## Source: conformance_ci_gate_v1.md

# Conformance CI Gate v1

Version: 1.1  
Status: Normative  
Scope: CI Governance — blocking rules, ordered test suites, invariant-to-test mapping, execution discipline

Strictly compatible with all Phase 8.x normative specifications (Local, Kernel, Sync Poll, Principal Filtered Cursor, Projection Cache, Subscribe, Overlay Mask, Remote EventStore, Conformance Model, Security Hardening, Application Layer).

---

# 1️⃣ Terminology and CI Scope (Normative)

## 1.1 CI Gate

A CI Gate is a mandatory automated validation stage that evaluates whether a revision satisfies all normative conformance requirements.

A CI Gate:
- Executes explicitly defined suites.
- Produces PASS / FAIL.
- Blocks merge if any blocking condition is met.

---

## 1.2 Critical Test

A Critical Test validates invariants whose violation breaks:

- append-only
- tx-closed strict
- meta → graph intra-transaction ordering
- strict idempotency
- principal-filtered cursor monotonicity and admissibility
- transaction-wide masking
- mask indistinguishability
- deterministic replay

Failure of a Critical Test = Blocking Failure.

---

## 1.3 Severity Levels

Tests are classified as:

- Critical — blocks merge
- Structural — blocks merge
- Regression — blocks merge
- Acceptable — reported but non-blocking

Normative rule:
- Critical, Structural and Regression tests are blocking.
- Acceptable tests do not block merge but MUST be visible in reports.

This aligns CI governance with the Conformance Test Model classification.

---

## 1.4 Blocking Failure

A Blocking Failure is any of the following:

- Failure of a Critical test
- Failure of a Structural test
- Failure of a Regression test
- CanonicalStateDump inequality where equality is required
- Violation of tx-closed
- Violation of mask indistinguishability

Blocking Failure ⇒ NO_MERGE_IF_RED.

---

## 1.5 Oracle

An Oracle is a formally defined comparison mechanism.

Types:

- Oracle A — Receipt / Error structural equality
- Oracle B — CanonicalStateDump replay equivalence
- Oracle C — Projection equivalence (normalized)
- Oracle D — Security indistinguishability (mask vs absent)

All comparisons MUST pass through canonical normalization.

---

## 1.6 Backend Target

A Backend Target is an execution environment under test:

- Local
- Remote

Remote backend MUST NOT be activable unless all CT-R-* gates pass.

---

# 2️⃣ Gating Policy (Normative)

## 2.1 NO_MERGE_IF_RED

A pull request MUST NOT be merged if any Blocking Failure exists.

No override is permitted for Critical invariants.

---

## 2.2 Stability of Reason Codes and Canonical Outputs

The following artifacts are version-stable and normative:

- reasonCode taxonomy
- CanonicalStateDump structure
- Receipt structure
- Cursor structure

Any change requires:
- explicit version increment
- golden update with change log

Silent modification is forbidden.

---

## 2.3 Remote Activation Gate

Remote backend is activable only if:

- All CT-R-* tests PASS
- Deterministic replay validated (Oracle B)
- tx-closed strict validated

Otherwise Remote MUST remain disabled.

---

# 3️⃣ Test Suites — Strict Order and Dependencies

Suites MUST execute in the following order.

---

## 3.1 Local EventStore Gate (CT-L-*)

Validates:
- append-only
- tx-closed strict
- tx_index derivability
- idempotency atomicity

Oracles:
- A
- B

All CT-L-* MUST PASS.

---

## 3.2 Kernel Minimal Gate

Validates:
- execute(cmd) determinism
- idempotency mismatch rejection
- receipt determinism
- baseGraphRevision opaque resolution

Oracles:
- A
- B

---

## 3.3 Sync Poll Gate

Validates:
- cross-stream tx-closed strict
- monotonic cursors
- pagination invariance

Oracles:
- B

---

## 3.4 Principal Filtered Cursor Gate (CT-SH-*)

Validates:
- absent vs masked indistinguishable
- transaction-wide masking
- cursor monotonicity rules

Oracles:
- D
- A

---

## 3.5 Projection Cache Gate (CT-PC-*)

Validates:
- no cross-principal cache
- invalidation on visibility change
- rebuild == incremental (per principal)

Oracles:
- B
- C
- D

---

## 3.6 Subscribe Best-Effort Gate

Validates:
- delivery unit = full transaction
- no partial transaction delivery
- fallback Poll triggers
- redelivery tolerance

Oracles:
- A
- B

---

## 3.7 Overlay / Mask Edge Gate (CT-OM-*)

Validates:
- entityIdMap non-revealing
- resolveRevision non-revealing
- lock masking strict
- idempotency stability under permission change

Oracles:
- A
- D

---

## 3.8 Remote Gate (CT-R-*)

Validates:
- append-only remote
- tx-closed strict remote
- deterministic replay remote
- persistent idempotency
- mask + sync indistinguishability

Oracles:
- A
- B
- D

Remote PASS required for activation.

---

## 3.9 Application / UI Gate (T-APP-CRIT-*)

Required when Application Layer is in delivery scope.

Validates:
- no UI inference under mask
- no partial transaction perceptible
- no cross-principal cache in UI
- receipt-only confirmation respected

Oracles:
- A
- D

UI MUST NOT reintroduce invariant violations validated at system layer.

---

# 4️⃣ Mapping Invariants → Tests → Oracles (Normative Table)

| Invariant | Covered By | Oracle | Surface | Severity |
|------------|------------|--------|----------|-----------|
| Append-only | CT-L-1, CT-R-* | B | Local/Remote | Critical |
| tx-closed strict | CT-L-2, Sync Poll, CT-R-* | B | Local/Sync/Remote | Critical |
| meta→graph order | CT-L-* | B | Local | Critical |
| Idempotency strict | CT-L-5, CT-R-* | A | Kernel/Remote | Critical |
| Mask indistinguishable | CT-SH-*, CT-OM-* | D | Sync/Overlay | Critical |
| Principal cursor monotone | CT-SH-* | A | Sync | Critical |
| No cross-principal cache | CT-PC-1 | D | Projection | Critical |
| Replay determinism | CT-L-*, CT-R-* | B | All | Critical |
| Projection rebuild equivalence | CT-PC-5 | C | Projection | Critical |
| UI no-inference | T-APP-CRIT-* | D | Application | Critical |

Normative rule:
- No Critical invariant may be uncovered.

---

# 5️⃣ Output Stability & Canonicalization

All comparisons MUST:
- Use canonical normalization
- Neutralize timestamps
- Canonicalize unordered collections
- Map generated IDs to stable placeholders

Determinism is mandatory.

Flaky behavior in Critical/Structural/Regression tests constitutes failure because determinism by replay is a normative invariant.

---

# 6️⃣ CI Execution Policy

## 6.1 Execution Moments

CI MUST run:
- On every PR
- On main branch

Nightly runs MAY extend coverage.

---

## 6.2 Determinism Requirement

Tests MUST be reproducible with fixed seed.

Flake handling:
- Critical → failure
- Structural → failure
- Regression → failure

Acceptable tests MAY be flaky but MUST be reported.

---

## 6.3 Parallelization

Parallel execution allowed only if:
- GraphSpaces isolated
- No shared EventStore state

Dependent suites MUST execute sequentially.

---

# 7️⃣ Conditional Product Activation

## 7.1 Remote Activation

Remote feature MAY be enabled only if Remote Gate PASS.

---

## 7.2 Subscribe Production Activation

Subscribe production MAY be enabled only if Subscribe Gate PASS.

---

## 7.3 Overlay Activation

Overlay commit workflow MAY be enabled only if Overlay Gate PASS.

---

## 7.4 Application Activation

Application production release MAY be declared READY only if Application/UI Gate PASS.

---

# 8️⃣ CI Audit Trail (Normative Minimum)

CI MUST retain for any Blocking Failure:

- CanonicalStateDump artifacts
- Normalized receipts/errors
- Event ranges involved
- Diff outputs

Artifacts MUST respect mask non-leak rules.

---

# 9️⃣ Execution Ready Checklist

A build is READY if and only if:

- Local Gate PASS
- Kernel Gate PASS
- Poll Gate PASS
- Principal Cursor Gate PASS
- Projection Cache Gate PASS
- Subscribe Gate PASS (if delivered)
- Overlay Mask Gate PASS
- Remote Gate PASS (if Remote delivered)
- Application Gate PASS (if Application delivered)

Otherwise ⇒ NOT READY.

---

# 🔒 Final Normative Rule

CI Gate operationalizes architectural invariants.

It MUST be impossible to:

- Merge code violating tx-closed
- Introduce mask leakage
- Activate Remote without conformity
- Activate UI leaking masked existence
- Declare feature complete without passing gates

Violation of this discipline constitutes governance failure.

---


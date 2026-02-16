import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES, canonicalString, stripNondeterminism } from "@mesh/shared";
import { buildCanonicalStateDump } from "@mesh/conformance-harness";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";

type StoreScope = {
  store: LocalEventStore;
  reopen: () => Promise<LocalEventStore>;
  cleanup: () => Promise<void>;
};

describe.each(getConformanceBackends())("CT-L-* Core Local (%s)", (backend: ConformanceBackend) => {
  let scope: StoreScope | undefined;

  beforeEach(async () => {
    scope = await makeStore(backend);
  });

  afterEach(async () => {
    await scope?.cleanup();
  });

  it("[INV:CT-L-1][SURF:EventStore] CT-L-1 Append-only immutability (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-1";
    task.meta.surface = "EventStore";
    task.meta.oracle = "Appended transaction envelopes are immutable in canonical form across repeated reads.";
    task.meta.criticality = "Critical";
    const store = scope!.store;
    const graphSpaceId = "space-l1";

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [{ step: 1 }], graphEvents: [{ node: "a" }] }, { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" });
    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [{ step: 2 }], graphEvents: [{ node: "b" }] }, { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" });

    const firstRead = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const secondRead = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const firstDump = await buildCanonicalStateDump(store, graphSpaceId);
    const secondDump = await buildCanonicalStateDump(store, graphSpaceId);

    expect(firstRead.map((e) => ({ seq: e.seq, txId: e.txId, eventId: e.eventId }))).toEqual([
      { seq: 1, txId: "tx-1", eventId: "tx-1-m-1" },
      { seq: 2, txId: "tx-2", eventId: "tx-2-m-1" }
    ]);
    expect(canonicalString(firstRead)).toEqual(canonicalString(secondRead));
    expect(canonicalString(firstDump)).toEqual(canonicalString(secondDump));
  });

  it("[INV:CT-L-2][SURF:EventStore] CT-L-2 tx-closed readRange extension (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-2";
    task.meta.surface = "EventStore";
    task.meta.oracle = "Extending read ranges preserves tx-closed boundaries and stable event ordering.";
    task.meta.criticality = "Critical";
    const store = scope!.store;
    const graphSpaceId = "space-l2";

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [{ m: 1 }, { m: 2 }], graphEvents: [{ g: 1 }] }, { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" });
    const snapshot = await store.getCursorHead(graphSpaceId);
    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [{ m: 3 }], graphEvents: [{ g: 2 }] }, { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" });

    const cut = await store.readRange(graphSpaceId, "meta", 0, 1, "TX_CLOSED");
    const snapshotRead = await store.readRange(graphSpaceId, "meta", 0, 10, "TX_CLOSED", { snapshotCursor: snapshot });

    expect(cut.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([{ txId: "tx-1", seq: 1 }, { txId: "tx-1", seq: 2 }]);
    expect(snapshotRead.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([{ txId: "tx-1", seq: 1 }, { txId: "tx-1", seq: 2 }]);
  });

  it("[INV:CT-L-3][SURF:EventStore] CT-L-3 tx_index monotonicity and two-stream ordering (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-3";
    task.meta.surface = "EventStore";
    task.meta.oracle = "txIndex increases monotonically and stream sequence ordering stays consistent across tx boundaries.";
    task.meta.criticality = "Critical";
    const store = scope!.store;
    const graphSpaceId = "space-l3";

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] }, { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" });
    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [{ m: 2 }, { m: 3 }], graphEvents: [{ g: 3 }] }, { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" });

    const meta = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const graph = await store.readRange(graphSpaceId, "graph", 0, 100, "TX_CLOSED");
    const txIndex = await store.readTxIndex(graphSpaceId);

    expect(meta.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([{ txId: "tx-1", seq: 1 }, { txId: "tx-2", seq: 2 }, { txId: "tx-2", seq: 3 }]);
    expect(graph.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([{ txId: "tx-1", seq: 1 }, { txId: "tx-1", seq: 2 }, { txId: "tx-2", seq: 3 }]);
    expect(txIndex).toEqual([
      { txId: "tx-1", txIndex: 1, meta: { start: 1, end: 1, count: 1 }, graph: { start: 1, end: 2, count: 2 } },
      { txId: "tx-2", txIndex: 2, meta: { start: 2, end: 3, count: 2 }, graph: { start: 3, end: 3, count: 1 } }
    ]);
  });

  it("[INV:CT-L-4][SURF:EventStore] CT-L-4 Tx boundary integrity + idempotence (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-4";
    task.meta.surface = "EventStore";
    task.meta.oracle = "A transaction is atomically persisted once and idempotent replay returns the original committed receipt.";
    task.meta.criticality = "Critical";
    const store = scope!.store;
    const graphSpaceId = "space-l4";
    const txBundle = { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] };
    const idem = { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" };

    const first = await store.appendTx(graphSpaceId, txBundle, idem);
    const second = await store.appendTx(graphSpaceId, txBundle, idem);
    const txIndex = await store.readTxIndex(graphSpaceId);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "committed",
      commandId: "tx-1",
      txId: "tx-1",
      txIndex: 1,
      cursorAfter: { metaSeq: 1, graphSeq: 2 },
      eventRefs: {
        meta: [{ stream: "meta", seq: 1, eventId: "tx-1-m-1" }],
        graph: [
          { stream: "graph", seq: 1, eventId: "tx-1-g-1" },
          { stream: "graph", seq: 2, eventId: "tx-1-g-2" }
        ]
      }
    });

    expect(txIndex).toEqual([{ txId: "tx-1", txIndex: 1, meta: { start: 1, end: 1, count: 1 }, graph: { start: 1, end: 2, count: 2 } }]);
  });

  it("[INV:CT-L-5][SURF:EventStore] CT-L-5 Fault Injection: crash before commit keeps store atomic", async ({ task }) => {
    task.meta.invariantId = "CT-L-5";
    task.meta.surface = "EventStore";
    task.meta.oracle = "Crash before commit must leave no partial transaction state (neither events nor idempotency entry).";
    task.meta.criticality = "Critical";
    const store = scope!.store;
    const graphSpaceId = "space-l5";
    const txId = "tx-l5";
    const idempotencyCtx = { actorId: "actor-1", idempotencyKey: "idem-l5", payloadHash: "hash-l5" };

    await expect(store.appendTx(graphSpaceId, { txId, metaEvents: [{ kind: "meta", phase: 9 }], graphEvents: [{ kind: "graph", phase: 9 }] }, idempotencyCtx, { failAt: "BEFORE_IDB_COMMIT" })).rejects.toThrowError("FAULT_INJECTION:BEFORE_IDB_COMMIT");

    const metaEvents = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const graphEvents = await store.readRange(graphSpaceId, "graph", 0, 100, "TX_CLOSED");
    const txIndexBeforeRetry = await store.readTxIndex(graphSpaceId);
    const headBeforeRetry = await store.getCursorHead(graphSpaceId);
    const retry = await store.appendTx(graphSpaceId, { txId, metaEvents: [{ kind: "meta", phase: 9 }], graphEvents: [{ kind: "graph", phase: 9 }] }, idempotencyCtx);

    expect(metaEvents).toEqual([]);
    expect(graphEvents).toEqual([]);
    expect(txIndexBeforeRetry).toEqual([]);
    expect(headBeforeRetry).toEqual({ metaSeq: 0, graphSeq: 0 });
    expect(retry).toMatchObject({ status: "committed", txId, txIndex: 1, cursorAfter: { metaSeq: 1, graphSeq: 1 } });
  });

  it("[INV:CT-L-6][SURF:EventStore] CT-L-6 contradiction: empty tx is rejected", async ({ task }) => {
    task.meta.invariantId = "CT-L-6";
    task.meta.surface = "EventStore";
    task.meta.oracle = "Empty transaction payload must be rejected with VALIDATION/EMPTY_TRANSACTION.";
    task.meta.criticality = "Regression";
    const store = scope!.store;
    const graphSpaceId = "space-l6";

    const result = await store.appendTx(graphSpaceId, { txId: "tx-empty", metaEvents: [], graphEvents: [] }, { actorId: "actor", idempotencyKey: "k-empty", payloadHash: "h-empty" });
    expect(result).toEqual({ status: "rejected", category: "VALIDATION", reasonCode: REASON_CODES.EMPTY_TX });
  });

  it("[INV:CT-L-7][SURF:EventStore] CT-L-7 restart realism: persisted tx survives reopen + idempotence (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-7";
    task.meta.surface = "EventStore";
    task.meta.oracle = "After restart, committed tx remains readable and idempotent replay returns original receipt without duplication.";
    task.meta.criticality = "Critical";
    if (backend !== "persistent") {
      return;
    }

    const graphSpaceId = "space-l7";
    const txBundle = { txId: "tx-restart", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }] };
    const idem = { actorId: "actor", idempotencyKey: "idem-restart", payloadHash: "hash-restart" };

    const first = await scope!.store.appendTx(graphSpaceId, txBundle, idem);
    const reopened = await scope!.reopen();
    const afterRestart = await reopened.readTx(graphSpaceId, "tx-restart");
    const replay = await reopened.appendTx(graphSpaceId, txBundle, idem);
    const index = await reopened.readTxIndex(graphSpaceId);

    expect(first).toEqual(replay);
    expect(afterRestart).not.toBeNull();
    expect(index).toHaveLength(1);
  });

  it("[INV:CT-L-8][SURF:EventStore] CT-L-8 restart realism: crash+restart around CT-L-5 keeps final state atomic (Critical)", async ({ task }) => {
    task.meta.invariantId = "CT-L-8";
    task.meta.surface = "EventStore";
    task.meta.oracle = "Crash before commit then restart keeps store atomic: no partial tx survives and clean retry commits once.";
    task.meta.criticality = "Critical";
    if (backend !== "persistent") {
      return;
    }

    const graphSpaceId = "space-l8";
    const tx = { txId: "tx-l8", metaEvents: [{ m: "m" }], graphEvents: [{ g: "g" }] };
    const idem = { actorId: "actor", idempotencyKey: "idem-l8", payloadHash: "hash-l8" };

    await expect(scope!.store.appendTx(graphSpaceId, tx, idem, { failAt: "BEFORE_IDB_COMMIT" })).rejects.toThrowError();

    const reopened = await scope!.reopen();
    expect(await reopened.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED")).toEqual([]);
    expect(await reopened.readRange(graphSpaceId, "graph", 0, 100, "TX_CLOSED")).toEqual([]);

    const committed = await reopened.appendTx(graphSpaceId, tx, idem);
    const reopenedAgain = await scope!.reopen();
    const index = await reopenedAgain.readTxIndex(graphSpaceId);

    expect(committed).toMatchObject({ status: "committed", txId: "tx-l8", txIndex: 1 });
    expect(index).toHaveLength(1);
  });

  it("sanity: canonical normalizer is deterministic and strips createdAt", () => {
    const a = { z: 1, a: { createdAt: "2024-01-01T00:00:00Z", name: "node" } };
    const b = { a: { createdAt: "2025-01-01T00:00:00Z", name: "node" }, z: 1 };

    expect(stripNondeterminism(a)).toEqual({ a: { name: "node" }, z: 1 });
    expect(canonicalString(a)).toEqual(canonicalString(b));
  });
});

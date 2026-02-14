import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES, canonicalString, stripNondeterminism } from "@mesh/shared";

// Invariant: append-only reads are stable (same seq/tx ordering) across repeated reads; fail if sequence/order drifts.
// Invariant: TX_CLOSED readRange extends to tx boundary and honors snapshotCursor; fail on half-tx or post-snapshot leak.
// Invariant: tx_index and per-stream seq are monotone and aligned with tx boundaries; fail on out-of-order index/seq.
// Invariant: idempotent replays return same committed receipt and do not duplicate tx_index rows; fail on divergence/duplication.
// Invariant: crash before commit is atomic (no partial visibility); fail if only one stream exposes tx events.
// Invariant: empty transaction is rejected with normalized reasonCode; fail if accepted or differently classified.
describe("CT-L-* Core Local", () => {
  it("[INV:CT-L-1][SURF:EventStore] CT-L-1 Append-only immutability (Critical)", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l1";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-1", metaEvents: [{ step: 1 }], graphEvents: [{ node: "a" }] },
      { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-2", metaEvents: [{ step: 2 }], graphEvents: [{ node: "b" }] },
      { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" }
    );

    const firstRead = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const secondRead = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");

    expect(firstRead.map((e) => ({ seq: e.seq, txId: e.txId, eventId: e.eventId }))).toEqual([
      { seq: 1, txId: "tx-1", eventId: "tx-1-m-1" },
      { seq: 2, txId: "tx-2", eventId: "tx-2-m-1" }
    ]);
    expect(canonicalString(firstRead)).toEqual(canonicalString(secondRead));
  });

  it("[INV:CT-L-2][SURF:EventStore] CT-L-2 tx-closed readRange extension (Critical)", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l2";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-1", metaEvents: [{ m: 1 }, { m: 2 }], graphEvents: [{ g: 1 }] },
      { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" }
    );

    const snapshot = await store.getCursorHead(graphSpaceId);

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-2", metaEvents: [{ m: 3 }], graphEvents: [{ g: 2 }] },
      { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" }
    );

    const cut = await store.readRange(graphSpaceId, "meta", 0, 1, "TX_CLOSED");
    const snapshotRead = await store.readRange(graphSpaceId, "meta", 0, 10, "TX_CLOSED", { snapshotCursor: snapshot });

    expect(cut.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([
      { txId: "tx-1", seq: 1 },
      { txId: "tx-1", seq: 2 }
    ]);
    expect(snapshotRead.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([
      { txId: "tx-1", seq: 1 },
      { txId: "tx-1", seq: 2 }
    ]);
  });

  it("[INV:CT-L-3][SURF:EventStore] CT-L-3 tx_index monotonicity and two-stream ordering (Critical)", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l3";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] },
      { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-2", metaEvents: [{ m: 2 }, { m: 3 }], graphEvents: [{ g: 3 }] },
      { actorId: "actor", idempotencyKey: "k-2", payloadHash: "h-2" }
    );

    const meta = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const graph = await store.readRange(graphSpaceId, "graph", 0, 100, "TX_CLOSED");
    const txIndex = await store.readTxIndex(graphSpaceId);

    expect(meta.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([
      { txId: "tx-1", seq: 1 },
      { txId: "tx-2", seq: 2 },
      { txId: "tx-2", seq: 3 }
    ]);
    expect(graph.map((e) => ({ txId: e.txId, seq: e.seq }))).toEqual([
      { txId: "tx-1", seq: 1 },
      { txId: "tx-1", seq: 2 },
      { txId: "tx-2", seq: 3 }
    ]);
    expect(txIndex).toEqual([
      { txId: "tx-1", txIndex: 1, meta: { start: 1, end: 1, count: 1 }, graph: { start: 1, end: 2, count: 2 } },
      { txId: "tx-2", txIndex: 2, meta: { start: 2, end: 3, count: 2 }, graph: { start: 3, end: 3, count: 1 } }
    ]);
  });

  it("[INV:CT-L-4][SURF:EventStore] CT-L-4 Tx boundary integrity + idempotence (Critical)", async () => {
    const store = new InMemoryLocalEventStore();
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

  it("[INV:CT-L-5][SURF:EventStore] CT-L-5 Fault Injection: crash before commit keeps store atomic", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l5";
    const txId = "tx-l5";
    const idempotencyCtx = {
      actorId: "actor-1",
      idempotencyKey: "idem-l5",
      payloadHash: "hash-l5"
    };

    await expect(
      store.appendTx(
        graphSpaceId,
        {
          txId,
          metaEvents: [{ kind: "meta", phase: 9 }],
          graphEvents: [{ kind: "graph", phase: 9 }]
        },
        idempotencyCtx,
        { failAt: "BEFORE_IDB_COMMIT" }
      )
    ).rejects.toThrowError("FAULT_INJECTION:BEFORE_IDB_COMMIT");

    const metaEvents = await store.readRange(graphSpaceId, "meta", 0, 100, "TX_CLOSED");
    const graphEvents = await store.readRange(graphSpaceId, "graph", 0, 100, "TX_CLOSED");
    const retry = await store.appendTx(
      graphSpaceId,
      {
        txId,
        metaEvents: [{ kind: "meta", phase: 9 }],
        graphEvents: [{ kind: "graph", phase: 9 }]
      },
      idempotencyCtx
    );

    expect(metaEvents).toEqual([]);
    expect(graphEvents).toEqual([]);
    expect(retry).toMatchObject({ status: "committed", txId, txIndex: 1, cursorAfter: { metaSeq: 1, graphSeq: 1 } });
  });

  it("[INV:CT-L-6][SURF:EventStore] CT-L-6 contradiction: empty tx is rejected", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l6";

    const result = await store.appendTx(
      graphSpaceId,
      { txId: "tx-empty", metaEvents: [], graphEvents: [] },
      { actorId: "actor", idempotencyKey: "k-empty", payloadHash: "h-empty" }
    );

    expect(result).toEqual({ status: "rejected", category: "VALIDATION", reasonCode: REASON_CODES.EMPTY_TX });
  });

  it("sanity: canonical normalizer is deterministic and strips createdAt", () => {
    const a = {
      z: 1,
      a: { createdAt: "2024-01-01T00:00:00Z", name: "node" }
    };
    const b = {
      a: { createdAt: "2025-01-01T00:00:00Z", name: "node" },
      z: 1
    };

    expect(stripNondeterminism(a)).toEqual({ a: { name: "node" }, z: 1 });
    expect(canonicalString(a)).toEqual(canonicalString(b));
  });
});

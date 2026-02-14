import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { canonicalString, stripNondeterminism } from "@mesh/shared";

describe("CT-L-* Core Local", () => {
  it("CT-L-1 Append-only immutability (Critical)", async () => {
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

    expect(firstRead.map((e) => e.seq)).toEqual([1, 2]);
    expect(firstRead.map((e) => e.txId)).toEqual(["tx-1", "tx-2"]);
    expect(canonicalString(firstRead)).toEqual(canonicalString(secondRead));
  });

  it("CT-L-2 tx-closed readRange extension (Critical)", async () => {
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

    expect(cut).toHaveLength(2);
    expect(cut.map((e) => e.seq)).toEqual([1, 2]);
    expect(new Set(cut.map((e) => e.txId))).toEqual(new Set(["tx-1"]));
    expect(snapshotRead.map((e) => e.txId)).toEqual(["tx-1", "tx-1"]);
  });

  it("CT-L-3 tx_index monotonicity and two-stream ordering (Critical)", async () => {
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

    expect(meta.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(graph.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(txIndex.map((t) => t.txIndex)).toEqual([1, 2]);
  });

  it("CT-L-4 Tx boundary integrity + idempotence (Critical)", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-l4";
    const txBundle = { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] };
    const idem = { actorId: "actor", idempotencyKey: "k-1", payloadHash: "h-1" };

    const first = await store.appendTx(graphSpaceId, txBundle, idem);
    const second = await store.appendTx(graphSpaceId, txBundle, idem);
    const txIndex = await store.readTxIndex(graphSpaceId);

    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    if (first.status === "committed" && second.status === "committed") {
      expect(second).toEqual(first);
      expect(first.txIndex).toBe(1);
    }

    expect(txIndex).toHaveLength(1);
    expect(txIndex[0]).toMatchObject({
      txId: "tx-1",
      meta: { start: 1, end: 1, count: 1 },
      graph: { start: 1, end: 2, count: 2 }
    });
  });

  it("CT-L-5 Fault Injection: crash before commit keeps store atomic", async () => {
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

    const nothingVisible = metaEvents.length === 0 && graphEvents.length === 0;
    const fullVisible =
      metaEvents.length === 1 &&
      graphEvents.length === 1 &&
      metaEvents[0]?.txId === txId &&
      graphEvents[0]?.txId === txId;

    expect(nothingVisible || fullVisible).toBe(true);
    expect(!(metaEvents.length === 1 && graphEvents.length === 0)).toBe(true);
    expect(!(metaEvents.length === 0 && graphEvents.length === 1)).toBe(true);

    if (nothingVisible) {
      expect(retry.status).toBe("committed");
      if (retry.status === "committed") {
        expect(retry.txId).toBe(txId);
      }
      return;
    }

    expect(retry.status).toBe("committed");
    if (retry.status === "committed") {
      expect(retry.txId).toBe(txId);
      expect(retry.cursorAfter).toEqual({ metaSeq: 1, graphSeq: 1 });
    }
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

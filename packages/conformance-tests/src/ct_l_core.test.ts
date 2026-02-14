import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { canonicalString, stripNondeterminism } from "@mesh/shared";

describe("CT-L-* Core Local", () => {
  it.skip("CT-L-1 Append-only immutability (Critical)");
  it.skip("CT-L-2 tx-closed readRange extension (Critical)");
  it.skip("CT-L-3 Two-stream ordering (Critical)");
  it.skip("CT-L-4 Tx boundary integrity (Critical)");

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

import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";

describe("CT-C-* Cursor semantics per principal", () => {
  it("CT-C-1: principal cursor is monotone and tx-closed", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-c1";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] },
      { actorId: "actor", idempotencyKey: "c1-k1", payloadHash: "c1-h1" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-2", metaEvents: [{ m: 2 }], graphEvents: [{ g: 3 }] },
      { actorId: "actor", idempotencyKey: "c1-k2", payloadHash: "c1-h2" }
    );

    const first = await store.readPrincipalTxRange(graphSpaceId, 0, 1, { principalId: "alice" });
    const second = await store.readPrincipalTxRange(graphSpaceId, first.cursor, 1, { principalId: "alice" });

    expect(first.cursor).toBe(1);
    expect(second.cursor).toBe(2);
    expect(second.cursor).toBeGreaterThanOrEqual(first.cursor);
    expect(first.txs[0]?.meta).toHaveLength(1);
    expect(first.txs[0]?.graph).toHaveLength(2);
  });

  it("CT-C-2: hidden tx does not advance principal cursor", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-c2";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-visible-1", metaEvents: [], graphEvents: [{ g: 1 }] },
      { actorId: "actor", idempotencyKey: "c2-k1", payloadHash: "c2-h1" }
    );
    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-hidden",
        metaEvents: [],
        graphEvents: [{ g: 2, _acl: { alice: "deny" } }]
      },
      { actorId: "actor", idempotencyKey: "c2-k2", payloadHash: "c2-h2" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-visible-2", metaEvents: [], graphEvents: [{ g: 3 }] },
      { actorId: "actor", idempotencyKey: "c2-k3", payloadHash: "c2-h3" }
    );

    const first = await store.readPrincipalTxRange(graphSpaceId, 0, 1, { principalId: "alice" });
    const second = await store.readPrincipalTxRange(graphSpaceId, first.cursor, 1, { principalId: "alice" });

    expect(first.txs.map((tx) => tx.txId)).toEqual(["tx-visible-1"]);
    expect(second.txs.map((tx) => tx.txId)).toEqual(["tx-visible-2"]);
    expect(second.cursor).toBe(2);

    const global = await store.readTxIndex(graphSpaceId);
    expect(global.at(-1)?.txIndex).toBe(3);
  });
});

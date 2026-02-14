import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES } from "@mesh/shared";

describe("CT-S-* Security masking and indistinguishability", () => {
  it("CT-S-1: absent and masked tx are indistinguishable", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-s1";

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-masked",
        metaEvents: [],
        graphEvents: [{ kind: "node", _acl: { alice: "mask", "*": "deny" } }]
      },
      { actorId: "system", idempotencyKey: "s1-k1", payloadHash: "s1-h1" }
    );

    const missing = await store.readTxForPrincipal(graphSpaceId, "tx-absent", { principalId: "alice" });
    const masked = await store.readTxForPrincipal(graphSpaceId, "tx-masked", { principalId: "alice" });

    expect(missing).toEqual(masked);
    expect(missing).toMatchObject({ status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED });
    expect(JSON.stringify(missing)).not.toContain("baseRevision");
  });

  it("CT-S-2: masked event hides full transaction without observable holes", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-s2";

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-visible-1",
        metaEvents: [{ op: "meta-1" }],
        graphEvents: [{ op: "graph-1" }]
      },
      { actorId: "system", idempotencyKey: "s2-k1", payloadHash: "s2-h1" }
    );

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-masked",
        metaEvents: [{ op: "meta-2" }],
        graphEvents: [{ op: "graph-2", _acl: { alice: "mask" } }]
      },
      { actorId: "system", idempotencyKey: "s2-k2", payloadHash: "s2-h2" }
    );

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-visible-2",
        metaEvents: [{ op: "meta-3" }],
        graphEvents: [{ op: "graph-3" }]
      },
      { actorId: "system", idempotencyKey: "s2-k3", payloadHash: "s2-h3" }
    );

    const principalRead = await store.readPrincipalTxRange(graphSpaceId, 0, 10, { principalId: "alice" });
    expect(principalRead.txs.map((tx) => tx.txId)).toEqual(["tx-visible-1", "tx-visible-2"]);
    expect(principalRead.cursor).toBe(2);

    const global = await store.readTxIndex(graphSpaceId);
    expect(global).toHaveLength(3);
  });
});

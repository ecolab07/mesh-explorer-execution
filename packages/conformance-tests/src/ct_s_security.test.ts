import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES } from "@mesh/shared";

// Invariant: absent and masked tx are indistinguishable (same category/code/shape and no metadata leaks); fail on any field divergence.
// Invariant: masking is transaction-wide (one masked event masks the whole tx); fail if any part of that tx is visible.
// Invariant: no observable side-channel via cursor/extra keys between absent and masked reads; fail if response shape differs.
describe("CT-S-* Security masking and indistinguishability", () => {
  it("CT-S-1: absent and masked tx are indistinguishable", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-s1";

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-masked",
        metaEvents: [{ kind: "meta" }],
        graphEvents: [{ kind: "node", _acl: { alice: "mask", "*": "deny" } }]
      },
      { actorId: "system", idempotencyKey: "s1-k1", payloadHash: "s1-h1" }
    );

    const missing = await store.readTxForPrincipal(graphSpaceId, "tx-absent", { principalId: "alice" });
    const masked = await store.readTxForPrincipal(graphSpaceId, "tx-masked", { principalId: "alice" });

    const expected = { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
    expect(missing).toEqual(expected);
    expect(masked).toEqual(expected);
    expect(Object.keys(masked).sort()).toEqual(Object.keys(missing).sort());
    expect(masked).not.toHaveProperty("baseRevision");
    expect(masked).not.toHaveProperty("cursor");
    expect(masked).not.toHaveProperty("metadata");
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
        txId: "tx-masked-transaction-wide",
        metaEvents: [{ op: "meta-2" }],
        graphEvents: [{ op: "graph-2a" }, { op: "graph-2b", _acl: { alice: "mask" } }]
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
    expect(principalRead).toEqual({
      txs: [
        {
          txId: "tx-visible-1",
          txIndex: 1,
          meta: [expect.objectContaining({ txId: "tx-visible-1", stream: "meta", seq: 1 })],
          graph: [expect.objectContaining({ txId: "tx-visible-1", stream: "graph", seq: 1 })]
        },
        {
          txId: "tx-visible-2",
          txIndex: 3,
          meta: [expect.objectContaining({ txId: "tx-visible-2", stream: "meta", seq: 3 })],
          graph: [expect.objectContaining({ txId: "tx-visible-2", stream: "graph", seq: 4 })]
        }
      ],
      cursor: 2
    });
  });

  it("CT-S-3 contradiction: absent vs masked no side-channel shape", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-s3";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-m", metaEvents: [], graphEvents: [{ kind: "hidden", _acl: { alice: "mask" } }] },
      { actorId: "system", idempotencyKey: "s3-k1", payloadHash: "s3-h1" }
    );

    const absent = await store.readTxForPrincipal(graphSpaceId, "tx-never-existed", { principalId: "alice" });
    const masked = await store.readTxForPrincipal(graphSpaceId, "tx-m", { principalId: "alice" });

    expect(JSON.stringify(masked)).toBe(JSON.stringify(absent));
  });
});

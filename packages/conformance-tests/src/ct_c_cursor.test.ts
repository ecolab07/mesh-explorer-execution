import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES } from "@mesh/shared";

// Invariant: principal cursor is monotone and tx-closed; fail if cursor regresses or a tx is partially returned.
// Invariant: invisible tx does not create observable holes for each principal; fail if cursor jumps/leaks hidden tx positions.
// Invariant: hidden tx remains unreadable by principal and yields normalized NOT_FOUND_OR_MASKED; fail if transaction is exposed.
describe("CT-C-* Cursor semantics per principal", () => {
  it("[INV:CT-C-1][SURF:Cursor] CT-C-1: principal cursor is monotone and tx-closed", async ({ task }) => {
    task.meta.invariantId = "CT-C-1";
    task.meta.surface = "Cursor";
    task.meta.oracle = "Principal reads must return whole visible transactions in txIndex order and advance cursor by visible transaction count only.";
    task.meta.criticality = "Structural";
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

    expect(first).toEqual({
      txs: [
        {
          txId: "tx-1",
          txIndex: 1,
          meta: [expect.objectContaining({ txId: "tx-1", seq: 1 })],
          graph: [expect.objectContaining({ txId: "tx-1", seq: 1 }), expect.objectContaining({ txId: "tx-1", seq: 2 })]
        }
      ],
      cursor: 1
    });
    expect(second).toEqual({
      txs: [
        {
          txId: "tx-2",
          txIndex: 2,
          meta: [expect.objectContaining({ txId: "tx-2", seq: 2 })],
          graph: [expect.objectContaining({ txId: "tx-2", seq: 3 })]
        }
      ],
      cursor: 2
    });
  });

  it("[INV:CT-C-2][SURF:Cursor] CT-C-2: alternating visibility across principals has no observable holes", async ({ task }) => {
    task.meta.invariantId = "CT-C-2";
    task.meta.surface = "Cursor";
    task.meta.oracle = "Per-principal pagination must skip masked transactions without holes and keep each principal cursor monotone.";
    task.meta.criticality = "Structural";
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-c2";

    await store.appendTx(graphSpaceId, { txId: "tx-1-both", metaEvents: [], graphEvents: [{ g: 1 }] }, { actorId: "actor", idempotencyKey: "c2-k1", payloadHash: "c2-h1" });
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-2-alice-only", metaEvents: [], graphEvents: [{ g: 2, _acl: { bob: "deny" } }] },
      { actorId: "actor", idempotencyKey: "c2-k2", payloadHash: "c2-h2" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-3-bob-only", metaEvents: [], graphEvents: [{ g: 3, _acl: { alice: "mask" } }] },
      { actorId: "actor", idempotencyKey: "c2-k3", payloadHash: "c2-h3" }
    );
    await store.appendTx(graphSpaceId, { txId: "tx-4-both", metaEvents: [], graphEvents: [{ g: 4 }] }, { actorId: "actor", idempotencyKey: "c2-k4", payloadHash: "c2-h4" });

    const alicePage1 = await store.readPrincipalTxRange(graphSpaceId, 0, 2, { principalId: "alice" });
    const alicePage2 = await store.readPrincipalTxRange(graphSpaceId, alicePage1.cursor, 2, { principalId: "alice" });
    const bobPage1 = await store.readPrincipalTxRange(graphSpaceId, 0, 2, { principalId: "bob" });
    const bobPage2 = await store.readPrincipalTxRange(graphSpaceId, bobPage1.cursor, 2, { principalId: "bob" });

    expect(alicePage1).toEqual({
      txs: [expect.objectContaining({ txId: "tx-1-both", txIndex: 1 }), expect.objectContaining({ txId: "tx-2-alice-only", txIndex: 2 })],
      cursor: 2
    });
    expect(alicePage2).toEqual({ txs: [expect.objectContaining({ txId: "tx-4-both", txIndex: 3 })], cursor: 3 });
    expect(bobPage1).toEqual({
      txs: [expect.objectContaining({ txId: "tx-1-both", txIndex: 1 }), expect.objectContaining({ txId: "tx-3-bob-only", txIndex: 2 })],
      cursor: 2
    });
    expect(bobPage2).toEqual({ txs: [expect.objectContaining({ txId: "tx-4-both", txIndex: 3 })], cursor: 3 });
  });

  it("[INV:CT-C-3][SURF:Cursor] CT-C-3 contradiction: hidden tx cannot be read directly by masked principal", async ({ task }) => {
    task.meta.invariantId = "CT-C-3";
    task.meta.surface = "Cursor";
    task.meta.oracle = "Direct read of a masked transaction must be rejected with NOT_FOUND/NOT_FOUND_OR_MASKED.";
    task.meta.criticality = "Regression";
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-c3";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-hidden", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1, _acl: { alice: "mask" } }] },
      { actorId: "actor", idempotencyKey: "c3-k1", payloadHash: "c3-h1" }
    );

    const hidden = await store.readTxForPrincipal(graphSpaceId, "tx-hidden", { principalId: "alice" });
    expect(hidden).toEqual({ status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED });
  });
});

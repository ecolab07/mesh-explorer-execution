import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { LocalSyncHarness } from "@mesh/sync-local";

describe("CT-SYNC-* Local sync harness", () => {
  it("CT-SYNC-1: poll is tx-closed and filtered by principal", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sync1";
    const harness = new LocalSyncHarness(store, graphSpaceId);

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }, { g: 2 }] },
      { actorId: "actor", idempotencyKey: "sync-k1", payloadHash: "sync-h1" }
    );
    await store.appendTx(
      graphSpaceId,
      { txId: "tx-hidden", metaEvents: [], graphEvents: [{ g: 3, _acl: { alice: "mask" } }] },
      { actorId: "actor", idempotencyKey: "sync-k2", payloadHash: "sync-h2" }
    );

    const poll = await harness.poll({ principalId: "alice" }, 0, 10);
    expect(poll.txIds).toEqual(["tx-1"]);
    expect(poll.principalCursorAfter).toBe(1);
  });

  it("CT-SYNC-2: subscribeOnce returns coherent follow-up cursor", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sync2";
    const harness = new LocalSyncHarness(store, graphSpaceId);

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ g: 1 }] }, { actorId: "actor", idempotencyKey: "sync2-k1", payloadHash: "sync2-h1" });
    const first = await harness.subscribeOnce({ principalId: "alice" }, 0, 1);

    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ g: 2 }] }, { actorId: "actor", idempotencyKey: "sync2-k2", payloadHash: "sync2-h2" });
    const second = await harness.subscribeOnce({ principalId: "alice" }, first.principalCursorAfter, 1);

    expect(first).toEqual({ txIds: ["tx-1"], principalCursorAfter: 1 });
    expect(second).toEqual({ txIds: ["tx-2"], principalCursorAfter: 2 });
  });
});

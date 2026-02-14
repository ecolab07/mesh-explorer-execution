import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { REASON_CODES } from "@mesh/shared";
import { LocalSyncHarness } from "@mesh/sync-local";

// Invariant: poll is tx-closed, principal-filtered, and cursor-exact; fail if masked tx appears or cursor leaks hidden tx.
// Invariant: subscribeOnce is equivalent to poll for follow-up cursors; fail if replay window duplicates/skips tx.
// Invariant: end-to-end submit->poll->receipt->replay is coherent and deterministic; fail if receipt/poll/replay disagree.
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
    expect(poll).toEqual({ txIds: ["tx-1"], principalCursorAfter: 1 });
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

  it("CT-SYNC-3: end-to-end submit -> poll -> receipt -> replay", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sync3";
    const harness = new LocalSyncHarness(store, graphSpaceId);
    const kernel = new KernelMinimalImpl(store);

    const receipt = await kernel.execute({
      graphSpaceId,
      commandId: "cmd-sync-1",
      actorId: "actor-sync",
      idempotencyKey: "idem-sync-1",
      payload: { op: "SET", value: 42 }
    });

    const firstPoll = await harness.poll({ principalId: "alice" }, 0, 10);
    const replayPoll = await harness.poll({ principalId: "alice" }, firstPoll.principalCursorAfter, 10);

    expect(receipt).toMatchObject({
      status: "committed",
      commandId: "cmd-sync-1",
      txId: "cmd-sync-1",
      txIndex: 1,
      cursorAfter: { metaSeq: 0, graphSeq: 1 }
    });
    expect(firstPoll).toEqual({ txIds: ["cmd-sync-1"], principalCursorAfter: 1 });
    expect(replayPoll).toEqual({ txIds: [], principalCursorAfter: 1 });
  });

  it("CT-SYNC-4 contradiction: rejected submit is never observable in poll", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sync4";
    const harness = new LocalSyncHarness(store, graphSpaceId);
    const kernel = new KernelMinimalImpl(store);

    const rejected = await kernel.execute({
      graphSpaceId,
      commandId: "cmd-sync-reject",
      actorId: "actor-sync",
      idempotencyKey: "idem-sync-reject",
      payload: { op: "SET", value: 1 },
      requireBaseRevision: "rev/invalid"
    });
    const poll = await harness.poll({ principalId: "alice" }, 0, 10);

    expect(rejected).toEqual({
      status: "rejected",
      commandId: "cmd-sync-reject",
      category: "VALIDATION",
      reasonCode: REASON_CODES.INVALID_BASE_REVISION
    });
    expect(poll).toEqual({ txIds: [], principalCursorAfter: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { LocalSyncGateway, StateDigestSyncClient, computeCanonicalStateDigest } from "@mesh/sync-local";
import type { PrincipalContext, TxBundle } from "@mesh/shared";

async function pollAll(
  gateway: LocalSyncGateway,
  graphSpaceId: string,
  principal: PrincipalContext
): Promise<{ state: Array<{ principalCursor: number; txBundle: TxBundle }>; cursor: number }> {
  const state: Array<{ principalCursor: number; txBundle: TxBundle }> = [];
  let cursor = 0;
  for (let round = 0; round < 64; round += 1) {
    const pulled = await gateway.syncPull(graphSpaceId, principal, cursor, { limitTx: 8 });
    if (pulled.txBundlesVisible.length === 0) break;
    state.push(...pulled.txBundlesVisible);
    cursor = pulled.cursorAfterVisible;
  }
  return { state, cursor };
}

describe("CT-SD-* StateDigest strict", () => {
  it("[INV:CT-SD-1][SURF:Sync] deterministic digest equivalence poll vs subscribe", async ({ task }) => {
    task.meta.invariantId = "CT-SD-1";
    task.meta.surface = "Sync";
    task.meta.oracle = "Digest is identical for principal-scoped state reconstructed by poll and subscribe application.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-1";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const client = new StateDigestSyncClient(gateway, graphSpaceId, principal);

    await store.appendTx(graphSpaceId, { txId: "sd1-tx-1", metaEvents: [{ at: 1 }], graphEvents: [{ node: "a", timestamp: 1 }] }, makeIdem("sd1-1"));
    await store.appendTx(graphSpaceId, { txId: "sd1-tx-2", metaEvents: [], graphEvents: [{ node: "b", createdAt: "t" }] }, makeIdem("sd1-2"));

    const stream = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: 8 });
    client.ingestSubscribeTxBundles(stream.txBundlesVisible);
    const commit = await client.validateAndCommit();

    const polled = await pollAll(gateway, graphSpaceId, principal);
    const pollDigest = computeCanonicalStateDigest(graphSpaceId, principal, polled.state, polled.cursor);

    expect(commit.committed).toBe(true);
    expect(client.snapshotDigest().digest).toBe(pollDigest.digest);
  });

  it("[INV:CT-SD-2][SURF:Sync] duplicate subscribe delivery preserves digest", async ({ task }) => {
    task.meta.invariantId = "CT-SD-2";
    task.meta.surface = "Sync";
    task.meta.oracle = "Duplicate subscribe deliveries are deduplicated and final digest remains stable.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-2";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const client = new StateDigestSyncClient(gateway, graphSpaceId, principal);

    await store.appendTx(graphSpaceId, { txId: "sd2-tx-1", metaEvents: [], graphEvents: [{ v: 1 }] }, makeIdem("sd2-1"));
    await store.appendTx(graphSpaceId, { txId: "sd2-tx-2", metaEvents: [], graphEvents: [{ v: 2 }] }, makeIdem("sd2-2"));

    const pulled = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: 8 });
    client.ingestSubscribeTxBundles(pulled.txBundlesVisible);
    client.ingestSubscribeTxBundles(pulled.txBundlesVisible);

    const commit = await client.validateAndCommit();
    const polled = await pollAll(gateway, graphSpaceId, principal);
    const pollDigest = computeCanonicalStateDigest(graphSpaceId, principal, polled.state, polled.cursor);

    expect(commit.committed).toBe(true);
    expect(client.snapshotDigest().digest).toBe(pollDigest.digest);
  });

  it("[INV:CT-SD-3][SURF:Sync] reconnect storm with gaps forces poll recovery then converges", async ({ task }) => {
    task.meta.invariantId = "CT-SD-3";
    task.meta.surface = "Sync";
    task.meta.oracle = "Gap/incoherence during subscribe blocks durable cursor and requires full poll before convergence.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-3";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const client = new StateDigestSyncClient(gateway, graphSpaceId, principal);

    await store.appendTx(graphSpaceId, { txId: "sd3-tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("sd3-1"));
    await store.appendTx(graphSpaceId, { txId: "sd3-tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, makeIdem("sd3-2"));
    await store.appendTx(graphSpaceId, { txId: "sd3-tx-3", metaEvents: [], graphEvents: [{ n: 3 }] }, makeIdem("sd3-3"));

    const firstOnly = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: 1 });
    client.ingestSubscribeTxBundles(firstOnly.txBundlesVisible);

    const lostMiddle = await gateway.syncPull(graphSpaceId, principal, 2, { limitTx: 1 });
    const ingestGap = client.ingestSubscribeTxBundles(lostMiddle.txBundlesVisible);
    const failedCommit = await client.validateAndCommit();

    expect(ingestGap.requiresPoll).toBe(true);
    expect(failedCommit.committed).toBe(false);
    expect(client.getDurableCursor()).toBe(0);

    await client.recoverByFullPoll();
    const recoveredCommit = await client.validateAndCommit();

    expect(recoveredCommit.committed).toBe(true);
    expect(client.getDurableCursor()).toBe(3);
  });

  it("[INV:CT-SD-4][SURF:Sync] crash/reload keeps durable cursor at last poll-validated position", async ({ task }) => {
    task.meta.invariantId = "CT-SD-4";
    task.meta.surface = "Sync";
    task.meta.oracle = "After crash before poll validation, reloaded client starts from persisted durable cursor only.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-4";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const cursorStore = { value: 0 };

    await store.appendTx(graphSpaceId, { txId: "sd4-tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("sd4-1"));
    await store.appendTx(graphSpaceId, { txId: "sd4-tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, makeIdem("sd4-2"));

    const clientA = new StateDigestSyncClient(gateway, graphSpaceId, principal);
    const baseline = await pollAll(gateway, graphSpaceId, principal);
    clientA.initializeDurableState(baseline.state.slice(0, 1), 1);
    cursorStore.value = 1;

    const newDelta = await gateway.syncPull(graphSpaceId, principal, 1, { limitTx: 8 });
    clientA.ingestSubscribeTxBundles(newDelta.txBundlesVisible);

    expect(clientA.getCandidateCursor()).toBe(2);
    expect(clientA.getDurableCursor()).toBe(1);

    const clientB = new StateDigestSyncClient(gateway, graphSpaceId, principal);
    const persisted = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: cursorStore.value });
    clientB.initializeDurableState(persisted.txBundlesVisible, cursorStore.value);

    expect(clientB.getDurableCursor()).toBe(1);
    expect(clientB.getCandidateCursor()).toBe(1);
  });
});

function makeIdem(key: string) {
  return {
    actorId: "writer",
    idempotencyKey: key,
    payloadHash: key
  };
}

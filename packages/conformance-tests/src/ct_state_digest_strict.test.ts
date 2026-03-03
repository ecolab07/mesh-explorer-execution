import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { LocalSyncGateway } from "@mesh/sync-local";
import { StateDigestSyncClient, computeCanonicalStateDigest } from "@mesh/sync-local/internal";
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

  it("[INV:CT-SD-5][SURF:Sync] durable cursor never advances before poll+digest validation", async ({ task }) => {
    task.meta.invariantId = "CT-SD-5";
    task.meta.surface = "Sync";
    task.meta.oracle = "Durable cursor remains pinned to persisted value until poll+digest validation completes.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-5";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });

    await store.appendTx(graphSpaceId, { txId: "sd5-tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("sd5-1"));
    await store.appendTx(graphSpaceId, { txId: "sd5-tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, makeIdem("sd5-2"));

    const bootstrapClient = new StateDigestSyncClient(gateway, graphSpaceId, principal);
    const first = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: 1 });
    bootstrapClient.initializeDurableState(first.txBundlesVisible, 1);

    const subscribeDelta = await gateway.syncPull(graphSpaceId, principal, 1, { limitTx: 8 });
    bootstrapClient.ingestSubscribeTxBundles(subscribeDelta.txBundlesVisible);

    expect(bootstrapClient.getCandidateCursor()).toBe(2);
    expect(bootstrapClient.getDurableCursor()).toBe(1);

    const persistedDurableCursor = bootstrapClient.getDurableCursor();
    const reloadedClient = new StateDigestSyncClient(gateway, graphSpaceId, principal);
    reloadedClient.initializeDurableState(first.txBundlesVisible, persistedDurableCursor);

    expect(reloadedClient.getDurableCursor()).toBe(1);
    expect(reloadedClient.getCandidateCursor()).toBe(1);
  });

  it("[INV:CT-SD-6][SURF:Sync] subscribe gap forces poll recovery and no partial candidate apply", async ({ task }) => {
    task.meta.invariantId = "CT-SD-6";
    task.meta.surface = "Sync";
    task.meta.oracle = "Gap delivery during subscribe does not apply candidate state and forces poll recovery.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-6";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const client = new StateDigestSyncClient(gateway, graphSpaceId, principal);

    for (let idx = 1; idx <= 3; idx += 1) {
      await store.appendTx(graphSpaceId, { txId: `sd6-tx-${idx}`, metaEvents: [], graphEvents: [{ idx }] }, makeIdem(`sd6-${idx}`));
    }

    const gapOnly = await gateway.syncPull(graphSpaceId, principal, 1, { limitTx: 1 });
    const ingest = client.ingestSubscribeTxBundles(gapOnly.txBundlesVisible);
    expect(ingest.accepted).toBe(0);
    expect(client.getCandidateCursor()).toBe(0);
    expect(ingest.requiresPoll).toBe(true);

    await client.recoverByFullPoll();
    const commit = await client.validateAndCommit();
    const polled = await pollAll(gateway, graphSpaceId, principal);

    expect(commit.committed).toBe(true);
    expect(client.getDurableCursor()).toBe(polled.cursor);
    expect(client.getDecisionLog().some((entry) => entry.reason === "subscribe_gap_detected")).toBe(true);
    expect(client.getDecisionLog().some((entry) => entry.reason === "poll_recovery_triggered")).toBe(true);
  });

  it("[INV:CT-SD-7][SURF:Sync] storm fuzz converges with durable cursor barrier", async ({ task }) => {
    task.meta.invariantId = "CT-SD-7";
    task.meta.surface = "Sync";
    task.meta.oracle = "Under drop/dup/reconnect storms, durable cursor advances only post-validation and converges to poll replay.";
    task.meta.criticality = "Critical";

    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-sd-7";
    const principal = { principalId: "alice" };
    const gateway = new LocalSyncGateway(store, { graphSpaceId });
    const client = new StateDigestSyncClient(gateway, graphSpaceId, principal);

    for (let idx = 1; idx <= 18; idx += 1) {
      await store.appendTx(graphSpaceId, { txId: `sd7-tx-${idx}`, metaEvents: [{ idx }], graphEvents: [{ idx }] }, makeIdem(`sd7-${idx}`));
    }

    const rng = seededRng(1337);
    let subscribeCursor = 0;

    for (let step = 0; step < 48; step += 1) {
      const pulled = await gateway.syncPull(graphSpaceId, principal, subscribeCursor, { limitTx: 3 });
      if (pulled.txBundlesVisible.length > 0) {
        subscribeCursor = pulled.cursorAfterVisible;
      }

      const planned = [...pulled.txBundlesVisible];
      if (planned.length > 0 && rng() < 0.35) {
        planned.shift();
      }
      if (planned.length > 0 && rng() < 0.4) {
        planned.push(planned[planned.length - 1]!);
      }
      if (planned.length > 1 && rng() < 0.35) {
        planned.reverse();
      }

      const beforeDurable = client.getDurableCursor();
      client.ingestSubscribeTxBundles(planned);
      const validation = await client.validateAndCommit();
      expect(client.getDurableCursor()).toBeGreaterThanOrEqual(beforeDurable);

      if (!validation.committed && validation.requiresPoll) {
        await client.recoverByFullPoll();
        const recovered = await client.validateAndCommit();
        expect(recovered.committed).toBe(true);
      }
    }

    const polled = await pollAll(gateway, graphSpaceId, principal);
    const pollDigest = computeCanonicalStateDigest(graphSpaceId, principal, polled.state, polled.cursor);

    expect(client.getDurableCursor()).toBe(polled.cursor);
    expect(client.snapshotDigest().digest).toBe(pollDigest.digest);

    const decisions = client.getDecisionLog();
    const durableSteps = decisions.filter((entry) => entry.reason === "durable_cursor_advanced");
    for (const step of durableSteps) {
      expect(step.pollValidatedCursor).toBeGreaterThanOrEqual(step.candidateCursor);
    }
  });

  it("[INV:CT-SD-8][SURF:Sync] mask/cursor non-leak sanity under principal-scoped digest", async ({ task }) => {
    task.meta.invariantId = "CT-SD-8";
    task.meta.surface = "Sync";
    task.meta.oracle = "Principal-scoped digest and visible cursors only track visible transactions under masking policy.";
    task.meta.criticality = "Critical";

    process.env.MESH_TX_VISIBILITY_POLICY = "acl";
    try {
      const store = new InMemoryLocalEventStore();
      const graphSpaceId = "space-sd-8";
      const gateway = new LocalSyncGateway(store, { graphSpaceId });
      const alice = { principalId: "alice" };
      const bob = { principalId: "bob" };

      await store.appendTx(
        graphSpaceId,
        {
          txId: "sd8-tx-1",
          metaEvents: [],
          graphEvents: [{ name: "public-1", _acl: { "*": "allow" } }]
        },
        makeIdem("sd8-1")
      );
      await store.appendTx(
        graphSpaceId,
        {
          txId: "sd8-tx-2",
          metaEvents: [],
          graphEvents: [{ name: "alice-only", _acl: { alice: "allow", bob: "mask" } }]
        },
        makeIdem("sd8-2")
      );
      await store.appendTx(
        graphSpaceId,
        {
          txId: "sd8-tx-3",
          metaEvents: [],
          graphEvents: [{ name: "public-2", _acl: { "*": "allow" } }]
        },
        makeIdem("sd8-3")
      );

      const alicePoll = await pollAll(gateway, graphSpaceId, alice);
      const bobPoll = await pollAll(gateway, graphSpaceId, bob);

      expect(alicePoll.cursor).toBe(3);
      expect(bobPoll.cursor).toBe(2);

      const aliceClient = new StateDigestSyncClient(gateway, graphSpaceId, alice);
      aliceClient.ingestSubscribeTxBundles((await gateway.syncPull(graphSpaceId, alice, 0, { limitTx: 16 })).txBundlesVisible);
      await aliceClient.validateAndCommit();

      const bobClient = new StateDigestSyncClient(gateway, graphSpaceId, bob);
      bobClient.ingestSubscribeTxBundles((await gateway.syncPull(graphSpaceId, bob, 0, { limitTx: 16 })).txBundlesVisible);
      await bobClient.validateAndCommit();

      expect(aliceClient.getDurableCursor()).toBe(3);
      expect(bobClient.getDurableCursor()).toBe(2);
      expect(aliceClient.snapshotDigest().digest).not.toBe(bobClient.snapshotDigest().digest);
    } finally {
      delete process.env.MESH_TX_VISIBILITY_POLICY;
    }
  });
});

function makeIdem(key: string) {
  return {
    actorId: "writer",
    idempotencyKey: key,
    payloadHash: key
  };
}

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

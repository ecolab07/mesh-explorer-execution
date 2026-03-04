import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import type { TxBundle } from "@mesh/shared";
import { PrincipalProjectionEngine, type ProjectionSnapshot } from "@mesh/projection-minimal";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { assertProjectionDeterminism, projectionEvidence } from "./projectionDeterminismHarness.js";

type StoreScope = {
  store: LocalEventStore;
  reopen: () => Promise<LocalEventStore>;
  cleanup: () => Promise<void>;
};

const BACKENDS = getConformanceBackends().filter((backend): backend is ConformanceBackend => backend !== "indexeddb");
const principal = { principalId: "alice" };

type ReplicaHarnessOptions = {
  writerStore: LocalEventStore;
  replicaStore: LocalEventStore;
  graphSpaceId: string;
  principalId: string;
  cursor?: number;
};

class PassiveReplicaHarness {
  private cursor: number;

  constructor(private readonly options: ReplicaHarnessOptions) {
    this.cursor = options.cursor ?? 0;
  }

  getCursor(): number {
    return this.cursor;
  }

  async pollOnce(limit: number): Promise<number> {
    const pulled = await this.options.writerStore.readPrincipalTxRange(
      this.options.graphSpaceId,
      this.cursor,
      limit,
      { principalId: this.options.principalId }
    );

    for (const tx of pulled.txs) {
      const txBundle: TxBundle = {
        txId: tx.txId,
        metaEvents: tx.meta.map((event) => event.payload),
        graphEvents: tx.graph.map((event) => event.payload)
      };

      const existing = await this.options.replicaStore.readTx(this.options.graphSpaceId, txBundle.txId);
      if (!existing) {
        await this.options.replicaStore.appendTx(this.options.graphSpaceId, txBundle, {
          actorId: "replica-poller",
          idempotencyKey: `replica:${this.options.graphSpaceId}:${txBundle.txId}`,
          payloadHash: JSON.stringify(txBundle)
        });
      }
    }

    this.cursor = pulled.cursor;
    return pulled.txs.length;
  }

  async pollToQuiescence(chunkPlan: number[]): Promise<number> {
    let iterations = 0;
    let chunkIdx = 0;
    while (iterations < 100) {
      const chunk = chunkPlan[chunkIdx % chunkPlan.length] ?? 1;
      const seen = await this.pollOnce(chunk);
      iterations += 1;
      chunkIdx += 1;
      if (seen === 0) {
        break;
      }
    }

    return this.cursor;
  }
}

function fixtureTxs(prefix: string, count: number): TxBundle[] {
  return Array.from({ length: count }, (_, idx) => {
    const n = idx + 1;
    return {
      txId: `${prefix}-tx-${n}`,
      metaEvents: [{ kind: "meta", n }],
      graphEvents: [{ id: `${prefix}-node-${n}`, tag: n % 2 === 0 ? "even" : "odd", n }]
    };
  });
}

async function appendTxs(store: LocalEventStore, graphSpaceId: string, txs: TxBundle[], prefix: string): Promise<void> {
  for (let idx = 0; idx < txs.length; idx += 1) {
    await store.appendTx(graphSpaceId, txs[idx], {
      actorId: "writer",
      idempotencyKey: `${prefix}-k-${idx}`,
      payloadHash: `${prefix}-h-${idx}`
    });
  }
}

async function buildProjection(store: LocalEventStore, graphSpaceId: string): Promise<ProjectionSnapshot> {
  return new PrincipalProjectionEngine(store, graphSpaceId).rebuild(principal);
}

function assertReplicaConvergence(testId: string, writer: ProjectionSnapshot, replica: ProjectionSnapshot): void {
  const writerEvidence = projectionEvidence(`${testId}:writer`, writer);
  const replicaEvidence = projectionEvidence(`${testId}:replica`, replica);

  if (writerEvidence.cursor !== replicaEvidence.cursor) {
    throw new Error(
      [
        `${testId} cursor mismatch.`,
        `writerCursor=${writerEvidence.cursor}`,
        `replicaCursor=${replicaEvidence.cursor}`,
        `writerDigest=${writerEvidence.projectionDigest}`,
        `replicaDigest=${replicaEvidence.projectionDigest}`,
        `writerDump=${writerEvidence.canonicalDump}`,
        `replicaDump=${replicaEvidence.canonicalDump}`
      ].join("\n")
    );
  }

  try {
    assertProjectionDeterminism(writerEvidence, replicaEvidence);
  } catch {
    throw new Error(
      [
        `${testId} digest mismatch.`,
        `writerCursor=${writerEvidence.cursor}`,
        `replicaCursor=${replicaEvidence.cursor}`,
        `writerDigest=${writerEvidence.projectionDigest}`,
        `replicaDigest=${replicaEvidence.projectionDigest}`,
        `writerDump=${writerEvidence.canonicalDump}`,
        `replicaDump=${replicaEvidence.canonicalDump}`
      ].join("\n")
    );
  }
}

describe.each(BACKENDS)("CT-REPLICA-PASSIVE-* (%s)", (backend) => {
  let writerScope: StoreScope;
  let replicaScope: StoreScope;

  beforeEach(async () => {
    writerScope = await makeStore(backend);
    replicaScope = await makeStore(backend);
  });

  afterEach(async () => {
    await writerScope.cleanup();
    await replicaScope.cleanup();
  });

  it("[INV:CT-REPLICA-PASSIVE-1][SURF:Replica] full replay poll converges to writer digest", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-PASSIVE-1";
    task.meta.surface = "Replica";
    task.meta.oracle = "Replica polling from K=0 converges to writer projection digest at equal tx-closed cursor.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-replica-passive-1-${backend}`;
    await appendTxs(writerScope.store, graphSpaceId, fixtureTxs("rp1", 12), "rp1");

    const replica = new PassiveReplicaHarness({
      writerStore: writerScope.store,
      replicaStore: replicaScope.store,
      graphSpaceId,
      principalId: principal.principalId
    });
    const cursor = await replica.pollToQuiescence([64]);

    const writerProjection = await buildProjection(writerScope.store, graphSpaceId);
    const replicaProjection = await buildProjection(replicaScope.store, graphSpaceId);

    expect(cursor).toBe(writerProjection.cursor);
    assertReplicaConvergence("CT-REPLICA-PASSIVE-1", writerProjection, replicaProjection);
  });

  it("[INV:CT-REPLICA-PASSIVE-2][SURF:Replica] chunked poll replay converges deterministically", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-PASSIVE-2";
    task.meta.surface = "Replica";
    task.meta.oracle = "Variable chunked poll replay converges to same projection digest at equal cursor.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-replica-passive-2-${backend}`;
    await appendTxs(writerScope.store, graphSpaceId, fixtureTxs("rp2", 17), "rp2");

    const replica = new PassiveReplicaHarness({
      writerStore: writerScope.store,
      replicaStore: replicaScope.store,
      graphSpaceId,
      principalId: principal.principalId
    });

    const cursor = await replica.pollToQuiescence([1, 3, 2, 4, 1, 5]);
    const writerProjection = await buildProjection(writerScope.store, graphSpaceId);
    const replicaProjection = await buildProjection(replicaScope.store, graphSpaceId);

    expect(cursor).toBe(writerProjection.cursor);
    assertReplicaConvergence("CT-REPLICA-PASSIVE-2", writerProjection, replicaProjection);
  });

  it("[INV:CT-REPLICA-PASSIVE-3][SURF:Replica] restart preserves digest at fixed cursor", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-PASSIVE-3";
    task.meta.surface = "Replica";
    task.meta.oracle = "Replica restart and replay-to-quiescence preserves digest when compared at same cursor.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-replica-passive-3-${backend}`;
    const txs = fixtureTxs("rp3", 14);
    await appendTxs(writerScope.store, graphSpaceId, txs, "rp3");

    const beforeRestartReplica = new PassiveReplicaHarness({
      writerStore: writerScope.store,
      replicaStore: replicaScope.store,
      graphSpaceId,
      principalId: principal.principalId
    });
    await beforeRestartReplica.pollToQuiescence([2, 2, 3]);

    const beforeProjection = await buildProjection(replicaScope.store, graphSpaceId);
    const savedCursor = beforeRestartReplica.getCursor();

    let restartedReplicaStore: LocalEventStore;
    if (backend === "persistent") {
      restartedReplicaStore = await replicaScope.reopen();
    } else {
      restartedReplicaStore = new InMemoryLocalEventStore();
      await appendTxs(restartedReplicaStore, graphSpaceId, txs, "rp3-restart");
    }

    const afterRestartReplica = new PassiveReplicaHarness({
      writerStore: writerScope.store,
      replicaStore: restartedReplicaStore,
      graphSpaceId,
      principalId: principal.principalId,
      cursor: savedCursor
    });
    await afterRestartReplica.pollToQuiescence([3, 1]);

    const writerProjection = await buildProjection(writerScope.store, graphSpaceId);
    const afterProjection = await buildProjection(restartedReplicaStore, graphSpaceId);

    assertReplicaConvergence("CT-REPLICA-PASSIVE-3:before-vs-writer", writerProjection, beforeProjection);
    assertReplicaConvergence("CT-REPLICA-PASSIVE-3:after-vs-writer", writerProjection, afterProjection);
    assertReplicaConvergence("CT-REPLICA-PASSIVE-3:before-vs-after", beforeProjection, afterProjection);
  });

  it("[INV:CT-REPLICA-PASSIVE-4][SURF:Replica] repeated poll-to-quiescence stays digest-stable", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-PASSIVE-4";
    task.meta.surface = "Replica";
    task.meta.oracle = "Polling repeatedly with no new events preserves cursor and projection digest.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-replica-passive-4-${backend}`;
    await appendTxs(writerScope.store, graphSpaceId, fixtureTxs("rp4", 9), "rp4");

    const replica = new PassiveReplicaHarness({
      writerStore: writerScope.store,
      replicaStore: replicaScope.store,
      graphSpaceId,
      principalId: principal.principalId
    });

    await replica.pollToQuiescence([3, 1, 2]);
    const firstProjection = await buildProjection(replicaScope.store, graphSpaceId);
    const firstCursor = replica.getCursor();

    await replica.pollToQuiescence([1, 1, 1]);
    const secondProjection = await buildProjection(replicaScope.store, graphSpaceId);
    const secondCursor = replica.getCursor();

    expect(secondCursor).toBe(firstCursor);
    assertReplicaConvergence("CT-REPLICA-PASSIVE-4", firstProjection, secondProjection);
  });
});

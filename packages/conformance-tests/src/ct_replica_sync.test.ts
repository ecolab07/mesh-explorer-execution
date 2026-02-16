import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import type { LocalEventStore } from "@mesh/eventstore-local";
import type { CommandError, IdempotencyCtx, PrincipalContext, TransactionReceipt, TxBundle } from "@mesh/shared";
import { REASON_CODES, canonicalString } from "@mesh/shared";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

interface ReplicaEnvelope {
  graphSpaceId: string;
  principalId: string;
  principalCursor: number;
  txBundle: TxBundle;
  idempotencyCtx: IdempotencyCtx;
  canonicalHash: string;
}

class TestReplicaSource {
  constructor(
    private readonly eventStore: LocalEventStore,
    private readonly graphSpaceId: string
  ) {}

  async pull(principal: PrincipalContext, fromPrincipalCursorExclusive: number, limit: number): Promise<{ txs: ReplicaEnvelope[]; cursorAfter: number }> {
    const { txs, cursor } = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, fromPrincipalCursorExclusive, limit, principal);

    return {
      txs: txs.map((tx, idx) => {
        const txBundle: TxBundle = {
          txId: tx.txId,
          metaEvents: tx.meta.map((event) => event.payload),
          graphEvents: tx.graph.map((event) => event.payload)
        };

        return {
          graphSpaceId: this.graphSpaceId,
          principalId: principal.principalId,
          principalCursor: fromPrincipalCursorExclusive + idx + 1,
          txBundle,
          idempotencyCtx: {
            actorId: "replicator",
            idempotencyKey: `replica:${this.graphSpaceId}:${tx.txId}`,
            payloadHash: canonicalString(txBundle)
          },
          canonicalHash: canonicalString({ graphSpaceId: this.graphSpaceId, txBundle })
        };
      }),
      cursorAfter: cursor
    };
  }
}

class TestReplicaSink {
  constructor(private readonly eventStore: LocalEventStore) {}

  async apply(envelope: ReplicaEnvelope): Promise<TransactionReceipt | CommandError> {
    const observedHash = canonicalString({ graphSpaceId: envelope.graphSpaceId, txBundle: envelope.txBundle });
    if (observedHash !== envelope.canonicalHash) {
      return {
        status: "error",
        category: "INTERNAL",
        reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
        commandId: envelope.txBundle.txId
      };
    }

    const existing = await this.eventStore.readTx(envelope.graphSpaceId, envelope.txBundle.txId);
    if (existing) {
      return this.buildStableReceipt(envelope.graphSpaceId, envelope.txBundle.txId);
    }

    return this.eventStore.appendTx(envelope.graphSpaceId, envelope.txBundle, envelope.idempotencyCtx);
  }

  private async buildStableReceipt(graphSpaceId: string, txId: string): Promise<TransactionReceipt | CommandError> {
    const existing = await this.eventStore.readTx(graphSpaceId, txId);
    const entry = (await this.eventStore.readTxIndex(graphSpaceId)).find((tx) => tx.txId === txId);
    if (!existing || !entry) {
      return {
        status: "error",
        category: "INTERNAL",
        reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
        commandId: txId
      };
    }

    return {
      status: "committed",
      commandId: txId,
      txId,
      txIndex: entry.txIndex,
      cursorAfter: { metaSeq: entry.meta.end, graphSeq: entry.graph.end },
      eventRefs: {
        meta: existing.meta.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId })),
        graph: existing.graph.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId }))
      }
    };
  }
}

class InMemoryCheckpoint {
  private cursor = 0;
  async load(): Promise<number> {
    return this.cursor;
  }
  async save(cursor: number): Promise<void> {
    this.cursor = cursor;
  }
}

async function withVisibilityPolicy<T>(policy: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.MESH_TX_VISIBILITY_POLICY;
  process.env.MESH_TX_VISIBILITY_POLICY = policy;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.MESH_TX_VISIBILITY_POLICY;
    } else {
      process.env.MESH_TX_VISIBILITY_POLICY = previous;
    }
  }
}

describe("CT-REPLICA-* passive replica conformance", () => {
  it("[INV:CT-REPLICA-1][SURF:Replica] equivalence replica vs source at visible cursor K", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-1";
    task.meta.surface = "Replica";
    task.meta.oracle = "At principal-visible cursor K, passive replicated sink rebuild equals source rebuild for the same principal.";
    task.meta.criticality = "Critical";

    await withVisibilityPolicy("acl", async () => {
      const sourceStore = new InMemoryLocalEventStore();
      const sinkStore = new InMemoryLocalEventStore();
      const graphSpaceId = "space-replica-equivalence";
      const principal = { principalId: "alice" };

      await sourceStore.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("r1-1"));
      await sourceStore.appendTx(
        graphSpaceId,
        { txId: "tx-hidden", metaEvents: [], graphEvents: [{ n: 999, _acl: { alice: "mask" } }] },
        makeIdem("r1-hidden")
      );
      await sourceStore.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, makeIdem("r1-2"));

      const source = new TestReplicaSource(sourceStore, graphSpaceId);
      const sink = new TestReplicaSink(sinkStore);
      const checkpoint = new InMemoryCheckpoint();

      let cycles = 0;
      while (cycles < 10) {
        const from = await checkpoint.load();
        const pulled = await source.pull(principal, from, 2);
        if (pulled.txs.length === 0) break;
        for (const envelope of pulled.txs) {
          const applied = await sink.apply(envelope);
          expect(applied.status).toBe("committed");
          await checkpoint.save(envelope.principalCursor);
        }
        cycles += 1;
      }

      const sourceProjection = await new PrincipalProjectionEngine(sourceStore, graphSpaceId).rebuild(principal);
      const sinkProjection = await new PrincipalProjectionEngine(sinkStore, graphSpaceId).rebuild(principal);
      expect(sinkProjection).toEqual(sourceProjection);
      expect(sinkProjection.cursor).toBe(2);
    });
  });

  it("[INV:CT-REPLICA-2][SURF:Replica] crash between apply and checkpoint remains deterministic after restart", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-2";
    task.meta.surface = "Replica";
    task.meta.oracle = "Crash after apply but before checkpoint save only causes redelivery; replay converges without duplicates.";
    task.meta.criticality = "Critical";

    const sourceStore = new InMemoryLocalEventStore();
    const sinkStore = new InMemoryLocalEventStore();
    const graphSpaceId = "space-replica-crash";
    const principal = { principalId: "alice" };

    await sourceStore.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("r2-1"));
    await sourceStore.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, makeIdem("r2-2"));

    const source = new TestReplicaSource(sourceStore, graphSpaceId);
    const sink = new TestReplicaSink(sinkStore);
    const checkpoint = new InMemoryCheckpoint();

    const pulledBeforeCrash = await source.pull(principal, await checkpoint.load(), 2);
    const firstApply = await sink.apply(pulledBeforeCrash.txs[0]!);
    expect(firstApply.status).toBe("committed");

    const pulledAfterRestart = await source.pull(principal, await checkpoint.load(), 2);
    for (const envelope of pulledAfterRestart.txs) {
      const applied = await sink.apply(envelope);
      expect(applied.status).toBe("committed");
      await checkpoint.save(envelope.principalCursor);
    }

    const txIds = (await sinkStore.readTxIndex(graphSpaceId)).map((tx) => tx.txId);
    expect(txIds).toEqual(["tx-1", "tx-2"]);
  });

  it("[INV:CT-REPLICA-3][SURF:Replica] idempotency cross-node single-writer retry keeps stable receipt", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-3";
    task.meta.surface = "Replica";
    task.meta.oracle = "Redelivered transaction envelope returns committed receipt and does not duplicate replicated tx.";
    task.meta.criticality = "Critical";

    const sourceStore = new InMemoryLocalEventStore();
    const sinkStore = new InMemoryLocalEventStore();
    const graphSpaceId = "space-replica-idempotency";
    const principal = { principalId: "alice" };

    await sourceStore.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("r3-1"));

    const source = new TestReplicaSource(sourceStore, graphSpaceId);
    const sink = new TestReplicaSink(sinkStore);

    const pulled = await source.pull(principal, 0, 10);
    const envelope = pulled.txs[0]!;

    const first = await sink.apply(envelope);
    const second = await sink.apply(envelope);

    expect(first.status).toBe("committed");
    expect(second).toEqual(first);
    expect(await sinkStore.readTxIndex(graphSpaceId)).toHaveLength(1);
  });

  it("[INV:CT-REPLICA-4][SURF:Replica] absent vs masked indistinguishable in cursor/sync output", async ({ task }) => {
    task.meta.invariantId = "CT-REPLICA-4";
    task.meta.surface = "Replica";
    task.meta.oracle = "Principal pull receipts do not allow distinguishing absent transaction history from masked history.";
    task.meta.criticality = "Structural";

    await withVisibilityPolicy("acl", async () => {
      const principal = { principalId: "alice" };
      const graphSpaceId = "space-replica-mask";

      const absentStore = new InMemoryLocalEventStore();
      await absentStore.appendTx(graphSpaceId, { txId: "tx-visible", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("r4-visible-a"));

      const maskedStore = new InMemoryLocalEventStore();
      await maskedStore.appendTx(graphSpaceId, { txId: "tx-visible", metaEvents: [], graphEvents: [{ n: 1 }] }, makeIdem("r4-visible-b"));
      await maskedStore.appendTx(
        graphSpaceId,
        { txId: "tx-masked", metaEvents: [], graphEvents: [{ n: 2, _acl: { alice: "mask" } }] },
        makeIdem("r4-masked")
      );

      const absentSource = new TestReplicaSource(absentStore, graphSpaceId);
      const maskedSource = new TestReplicaSource(maskedStore, graphSpaceId);

      const absentPull = await absentSource.pull(principal, 0, 10);
      const maskedPull = await maskedSource.pull(principal, 0, 10);

      expect(absentPull.cursorAfter).toBe(maskedPull.cursorAfter);
      expect(absentPull.txs.map((tx) => tx.txBundle.txId)).toEqual(maskedPull.txs.map((tx) => tx.txBundle.txId));
      expect(absentPull.txs.map((tx) => tx.principalCursor)).toEqual(maskedPull.txs.map((tx) => tx.principalCursor));
    });
  });
});

function makeIdem(key: string): IdempotencyCtx {
  return {
    actorId: "writer",
    idempotencyKey: key,
    payloadHash: key
  };
}

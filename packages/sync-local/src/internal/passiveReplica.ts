import type { LocalEventStore } from "@mesh/eventstore-local";
import type { CommandError, IdempotencyCtx, PrincipalContext, TransactionReceipt, TxBundle } from "@mesh/shared";
import { REASON_CODES, canonicalString } from "@mesh/shared";

export interface ReplicaPullOptions {
  principal: PrincipalContext;
  fromPrincipalCursorExclusive: number;
  limit: number;
}

export interface ReplicatedTxBundle {
  graphSpaceId: string;
  principalId: string;
  principalCursor: number;
  txBundle: TxBundle;
  idempotencyCtx: IdempotencyCtx;
  canonicalHash: string;
}

export interface ReplicaPullResult {
  txBundles: ReplicatedTxBundle[];
  cursorAfter: number;
}

export interface ReplicaSource {
  pull(options: ReplicaPullOptions): Promise<ReplicaPullResult>;
}

export interface ReplicaSink {
  apply(txBundle: ReplicatedTxBundle): Promise<TransactionReceipt | CommandError>;
}

export interface ReplicaCheckpointStore {
  load(graphSpaceId: string, principal: PrincipalContext): Promise<number>;
  save(graphSpaceId: string, principal: PrincipalContext, cursor: number): Promise<void>;
}

export class InMemoryReplicaCheckpointStore implements ReplicaCheckpointStore {
  private readonly cursorBySlot = new Map<string, number>();

  async load(graphSpaceId: string, principal: PrincipalContext): Promise<number> {
    return this.cursorBySlot.get(`${graphSpaceId}::${principal.principalId}`) ?? 0;
  }

  async save(graphSpaceId: string, principal: PrincipalContext, cursor: number): Promise<void> {
    this.cursorBySlot.set(`${graphSpaceId}::${principal.principalId}`, cursor);
  }
}

export class EventStoreReplicaSource implements ReplicaSource {
  constructor(
    private readonly eventStore: LocalEventStore,
    private readonly graphSpaceId: string
  ) {}

  async pull(options: ReplicaPullOptions): Promise<ReplicaPullResult> {
    const { txs, cursor } = await this.eventStore.readPrincipalTxRange(
      this.graphSpaceId,
      options.fromPrincipalCursorExclusive,
      options.limit,
      options.principal
    );

    const txBundles = txs.map((tx, idx): ReplicatedTxBundle => {
      const txBundle: TxBundle = {
        txId: tx.txId,
        metaEvents: tx.meta.map((event) => event.payload),
        graphEvents: tx.graph.map((event) => event.payload)
      };
      return {
        graphSpaceId: this.graphSpaceId,
        principalId: options.principal.principalId,
        principalCursor: options.fromPrincipalCursorExclusive + idx + 1,
        txBundle,
        idempotencyCtx: {
          actorId: "replicator",
          idempotencyKey: `replica:${this.graphSpaceId}:${tx.txId}`,
          payloadHash: canonicalString(txBundle)
        },
        canonicalHash: canonicalString({ graphSpaceId: this.graphSpaceId, txBundle })
      };
    });

    return {
      txBundles,
      cursorAfter: cursor
    };
  }
}

export class EventStoreReplicaSink implements ReplicaSink {
  constructor(private readonly eventStore: LocalEventStore) {}

  async apply(txBundle: ReplicatedTxBundle): Promise<TransactionReceipt | CommandError> {
    const observedHash = canonicalString({ graphSpaceId: txBundle.graphSpaceId, txBundle: txBundle.txBundle });
    if (observedHash !== txBundle.canonicalHash) {
      return {
        status: "error",
        category: "INTERNAL",
        reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
        commandId: txBundle.txBundle.txId
      };
    }

    const existing = await this.eventStore.readTx(txBundle.graphSpaceId, txBundle.txBundle.txId);
    if (existing) {
      const existingBundle: TxBundle = {
        txId: existing.txId,
        metaEvents: existing.meta.map((event) => event.payload),
        graphEvents: existing.graph.map((event) => event.payload)
      };
      const existingHash = canonicalString({ graphSpaceId: txBundle.graphSpaceId, txBundle: existingBundle });
      if (existingHash !== txBundle.canonicalHash) {
        return {
          status: "error",
          category: "INTERNAL",
          reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
          commandId: txBundle.txBundle.txId
        };
      }
      return this.buildStableReceipt(txBundle.graphSpaceId, txBundle.txBundle.txId);
    }

    return this.eventStore.appendTx(txBundle.graphSpaceId, txBundle.txBundle, txBundle.idempotencyCtx);
  }

  private async buildStableReceipt(graphSpaceId: string, txId: string): Promise<TransactionReceipt | CommandError> {
    const existing = await this.eventStore.readTx(graphSpaceId, txId);
    const index = await this.eventStore.readTxIndex(graphSpaceId);
    const txIndexEntry = index.find((entry) => entry.txId === txId);

    if (!existing || !txIndexEntry) {
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
      txIndex: txIndexEntry.txIndex,
      cursorAfter: { metaSeq: txIndexEntry.meta.end, graphSeq: txIndexEntry.graph.end },
      eventRefs: {
        meta: existing.meta.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId })),
        graph: existing.graph.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId }))
      }
    };
  }
}

export class PassiveReplicator {
  constructor(
    private readonly source: ReplicaSource,
    private readonly sink: ReplicaSink,
    private readonly checkpointStore: ReplicaCheckpointStore,
    private readonly graphSpaceId: string,
    private readonly principal: PrincipalContext
  ) {}

  async replicateOnce(limit = 64): Promise<{ applied: number; cursorAfter: number }> {
    const fromCursorExclusive = await this.checkpointStore.load(this.graphSpaceId, this.principal);
    const pulled = await this.source.pull({
      principal: this.principal,
      fromPrincipalCursorExclusive: fromCursorExclusive,
      limit
    });

    let cursor = fromCursorExclusive;
    let applied = 0;
    for (const txBundle of pulled.txBundles) {
      const outcome = await this.sink.apply(txBundle);
      if (outcome.status !== "committed") {
        return { applied, cursorAfter: cursor };
      }
      cursor = txBundle.principalCursor;
      await this.checkpointStore.save(this.graphSpaceId, this.principal, cursor);
      applied += 1;
    }

    return { applied, cursorAfter: pulled.cursorAfter };
  }

  async replicateUntilCaughtUp(limit = 64, maxRounds = 256): Promise<{ applied: number; cursorAfter: number }> {
    let totalApplied = 0;
    let cursorAfter = await this.checkpointStore.load(this.graphSpaceId, this.principal);

    for (let round = 0; round < maxRounds; round += 1) {
      const result = await this.replicateOnce(limit);
      totalApplied += result.applied;
      cursorAfter = result.cursorAfter;
      if (result.applied === 0) {
        break;
      }
    }

    return { applied: totalApplied, cursorAfter };
  }
}

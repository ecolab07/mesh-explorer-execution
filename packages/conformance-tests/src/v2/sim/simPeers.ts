import type { LocalEventStore } from "@mesh/eventstore-local";
import type { CommandError, IdempotencyCtx, TransactionReceipt, TxBundle } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import { makeStore, type ConformanceBackend } from "../../backends.js";

export interface TxEnvelope {
  graphSpaceId: string;
  txBundle: TxBundle;
  idempotencyCtx: IdempotencyCtx;
}

export interface SimPeer {
  id: "A" | "B";
  store: LocalEventStore;
  cleanup: () => Promise<void>;
}

export async function makeSimPeers(backend: ConformanceBackend): Promise<{ A: SimPeer; B: SimPeer; cleanup: () => Promise<void> }> {
  const [scopeA, scopeB] = await Promise.all([makeStore(backend), makeStore(backend)]);

  const A: SimPeer = { id: "A", store: scopeA.store, cleanup: scopeA.cleanup };
  const B: SimPeer = { id: "B", store: scopeB.store, cleanup: scopeB.cleanup };

  return {
    A,
    B,
    cleanup: async () => {
      await Promise.all([A.cleanup(), B.cleanup()]);
    }
  };
}

export async function applyReplicatedTx(peer: SimPeer, envelope: TxEnvelope): Promise<TransactionReceipt | CommandError> {
  const existing = await peer.store.readTx(envelope.graphSpaceId, envelope.txBundle.txId);
  if (existing) {
    const index = await peer.store.readTxIndex(envelope.graphSpaceId);
    const matched = index.find((entry) => entry.txId === envelope.txBundle.txId);
    if (!matched) {
      return {
        status: "rejected",
        category: "INTERNAL",
        reasonCode: REASON_CODES.EVENTSTORE_CORRUPT_TX_INDEX,
        commandId: envelope.txBundle.txId
      };
    }
    return {
      status: "committed",
      commandId: envelope.txBundle.txId,
      txId: envelope.txBundle.txId,
      txIndex: matched.txIndex,
      cursorAfter: { metaSeq: matched.meta.end, graphSeq: matched.graph.end },
      eventRefs: {
        meta: existing.meta.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId })),
        graph: existing.graph.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId }))
      }
    };
  }

  return peer.store.appendTx(envelope.graphSpaceId, envelope.txBundle, envelope.idempotencyCtx);
}

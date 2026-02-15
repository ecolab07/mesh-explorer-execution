import type { LocalEventStore } from "@mesh/eventstore-local";
import type { CommandError, IdempotencyCtx, TransactionReceipt, TxBundle } from "@mesh/shared";
import { REASON_CODES, canonicalString } from "@mesh/shared";
import { makeStore, type ConformanceBackend } from "../../backends.js";

export type PassiveRole = "primary" | "replica";

export interface PassiveNode {
  id: string;
  role: PassiveRole;
  store: LocalEventStore;
  cleanup: () => Promise<void>;
}

export interface ReplicatedTxEnvelope {
  graphSpaceId: string;
  txBundle: TxBundle;
  idempotencyCtx: IdempotencyCtx;
  txIndex: number;
  canonicalHash: string;
}

interface ReplicaState {
  lastAppliedTxIndex: number;
  txHashById: Map<string, string>;
}

export interface PassiveReplicationHarness {
  primary: PassiveNode;
  replicas: PassiveNode[];
  appendOnPrimary: (graphSpaceId: string, txBundle: TxBundle, idempotencyCtx: IdempotencyCtx) => Promise<TransactionReceipt | CommandError>;
  appendOnNode: (node: PassiveNode, graphSpaceId: string, txBundle: TxBundle, idempotencyCtx: IdempotencyCtx) => Promise<TransactionReceipt | CommandError>;
  shipFrom: (primary: PassiveNode, graphSpaceId: string, cursor: number) => Promise<{ txEnvelopes: ReplicatedTxEnvelope[]; cursorAfter: number }>;
  applyToReplica: (replica: PassiveNode, txEnvelope: ReplicatedTxEnvelope) => Promise<TransactionReceipt | CommandError>;
  restartPrimary: () => Promise<boolean>;
  restartReplica: (replica: PassiveNode) => Promise<boolean>;
  cleanup: () => Promise<void>;
}

export async function makePassiveReplicationHarness(
  backend: ConformanceBackend,
  replicaCount: number
): Promise<PassiveReplicationHarness> {
  const writerScope = await makeStore(backend);
  const replicaScopes = await Promise.all(Array.from({ length: replicaCount }, () => makeStore(backend)));

  const primary: PassiveNode = {
    id: "primary",
    role: "primary",
    store: writerScope.store,
    cleanup: writerScope.cleanup
  };

  const replicas = replicaScopes.map((scope, idx): PassiveNode => ({
    id: `replica-${idx + 1}`,
    role: "replica",
    store: scope.store,
    cleanup: scope.cleanup
  }));

  const replicaStateById = new Map<string, ReplicaState>();

  async function getReplicaState(replica: PassiveNode, graphSpaceId: string): Promise<ReplicaState> {
    let state = replicaStateById.get(replica.id);
    if (!state) {
      const index = await replica.store.readTxIndex(graphSpaceId);
      state = { lastAppliedTxIndex: index.at(-1)?.txIndex ?? 0, txHashById: new Map() };
      replicaStateById.set(replica.id, state);
    }
    return state;
  }

  async function appendOnNode(
    node: PassiveNode,
    graphSpaceId: string,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx
  ): Promise<TransactionReceipt | CommandError> {
    if (node.role !== "primary") {
      throw new Error(`Passive replication invariant violated: direct write forbidden on replica ${node.id}`);
    }
    return node.store.appendTx(graphSpaceId, txBundle, idempotencyCtx);
  }

  async function shipFrom(
    writer: PassiveNode,
    graphSpaceId: string,
    cursor: number
  ): Promise<{ txEnvelopes: ReplicatedTxEnvelope[]; cursorAfter: number }> {
    if (writer.role !== "primary") {
      throw new Error("shipFrom requires a primary writer-authority node");
    }

    const index = await writer.store.readTxIndex(graphSpaceId);
    const toShip = index.filter((entry) => entry.txIndex > cursor);

    const txEnvelopes: ReplicatedTxEnvelope[] = [];
    for (const entry of toShip) {
      const tx = await writer.store.readTx(graphSpaceId, entry.txId);
      if (!tx) {
        return {
          txEnvelopes: [],
          cursorAfter: cursor
        };
      }

      const txBundle: TxBundle = {
        txId: entry.txId,
        metaEvents: tx.meta.map((event) => event.payload),
        graphEvents: tx.graph.map((event) => event.payload)
      };

      const idempotencyCtx: IdempotencyCtx = {
        actorId: "replicator",
        idempotencyKey: `ship:${graphSpaceId}:${entry.txId}`,
        payloadHash: canonicalString(txBundle)
      };

      txEnvelopes.push({
        graphSpaceId,
        txBundle,
        idempotencyCtx,
        txIndex: entry.txIndex,
        canonicalHash: canonicalString({ graphSpaceId, txBundle })
      });
    }

    return {
      txEnvelopes,
      cursorAfter: toShip.at(-1)?.txIndex ?? cursor
    };
  }

  async function applyToReplica(replica: PassiveNode, txEnvelope: ReplicatedTxEnvelope): Promise<TransactionReceipt | CommandError> {
    if (replica.role !== "replica") {
      throw new Error("applyToReplica requires a read-only replica node");
    }

    const state = await getReplicaState(replica, txEnvelope.graphSpaceId);
    const expectedNext = state.lastAppliedTxIndex + 1;

    if (txEnvelope.txIndex > expectedNext) {
      return {
        status: "rejected",
        category: "PRECONDITION",
        reasonCode: REASON_CODES.REPLICATION_ORDER_GAP,
        commandId: txEnvelope.txBundle.txId
      };
    }

    const observedHash = canonicalString({ graphSpaceId: txEnvelope.graphSpaceId, txBundle: txEnvelope.txBundle });
    if (txEnvelope.canonicalHash !== observedHash) {
      return {
        status: "error",
        category: "INTERNAL",
        reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
        commandId: txEnvelope.txBundle.txId
      };
    }

    const existing = await replica.store.readTx(txEnvelope.graphSpaceId, txEnvelope.txBundle.txId);
    if (existing) {
      const recordedHash = state.txHashById.get(txEnvelope.txBundle.txId);
      if (recordedHash && recordedHash !== txEnvelope.canonicalHash) {
        return {
          status: "error",
          category: "INTERNAL",
          reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
          commandId: txEnvelope.txBundle.txId
        };
      }
      return buildStableReceipt(replica, txEnvelope);
    }

    if (txEnvelope.txIndex < expectedNext) {
      return {
        status: "error",
        category: "INTERNAL",
        reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
        commandId: txEnvelope.txBundle.txId
      };
    }

    const outcome = await replica.store.appendTx(txEnvelope.graphSpaceId, txEnvelope.txBundle, txEnvelope.idempotencyCtx);
    if (outcome.status === "committed") {
      state.lastAppliedTxIndex = txEnvelope.txIndex;
      state.txHashById.set(txEnvelope.txBundle.txId, txEnvelope.canonicalHash);
    }
    return outcome;
  }

  return {
    primary,
    replicas,
    appendOnPrimary: (graphSpaceId, txBundle, idempotencyCtx) => appendOnNode(primary, graphSpaceId, txBundle, idempotencyCtx),
    appendOnNode,
    shipFrom,
    applyToReplica,
    restartPrimary: async () => {
      if (backend !== "persistent") return false;
      primary.store = await writerScope.reopen();
      return true;
    },
    restartReplica: async (replica) => {
      if (backend !== "persistent") return false;
      const idx = replicas.findIndex((node) => node.id === replica.id);
      if (idx < 0) return false;
      replicas[idx].store = await replicaScopes[idx].reopen();
      replicaStateById.delete(replicas[idx].id);
      return true;
    },
    cleanup: async () => {
      await Promise.all([primary.cleanup(), ...replicas.map((replica) => replica.cleanup())]);
    }
  };
}

async function buildStableReceipt(replica: PassiveNode, txEnvelope: ReplicatedTxEnvelope): Promise<TransactionReceipt | CommandError> {
  const existing = await replica.store.readTx(txEnvelope.graphSpaceId, txEnvelope.txBundle.txId);
  const index = await replica.store.readTxIndex(txEnvelope.graphSpaceId);
  const matched = index.find((entry) => entry.txId === txEnvelope.txBundle.txId);
  if (!existing || !matched) {
    return {
      status: "error",
      category: "INTERNAL",
      reasonCode: REASON_CODES.REPLICATION_DIVERGENCE_DETECTED,
      commandId: txEnvelope.txBundle.txId
    };
  }

  return {
    status: "committed",
    commandId: txEnvelope.txBundle.txId,
    txId: txEnvelope.txBundle.txId,
    txIndex: matched.txIndex,
    cursorAfter: { metaSeq: matched.meta.end, graphSeq: matched.graph.end },
    eventRefs: {
      meta: existing.meta.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId })),
      graph: existing.graph.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId }))
    }
  };
}

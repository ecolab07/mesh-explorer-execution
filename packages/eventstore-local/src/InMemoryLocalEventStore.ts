import type {
  CommandError,
  Cursor,
  EventEnvelope,
  FaultInjectionHooks,
  IdempotencyCtx,
  PrincipalContext,
  ReadMode,
  ReadRangeOptions,
  StreamName,
  TransactionReceipt,
  TxBundle,
  TxId,
  TxIndexEntry
} from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import type { LocalEventStore } from "./LocalEventStore.js";
import {
  buildTxBundles,
  countVisibleTxs,
  createAclTxVisibilityDecider,
  createDefaultTxVisibilityDecider,
  createEntitySecretMaskDecider,
  filterVisibleTxs,
  toVisibilityContext,
  type TxVisibilityDecider
} from "./internal/txVisibility.js";

/**
 * In-memory conformance implementation for LocalEventStore.
 */
export class InMemoryLocalEventStore implements LocalEventStore {
  private readonly txVisibilityDecider: TxVisibilityDecider;

  private readonly bySpace = new Map<
    string,
    {
      meta: EventEnvelope[];
      graph: EventEnvelope[];
      txIndex: TxIndexEntry[];
      txById: Map<TxId, TxIndexEntry>;
      idempotency: Map<string, { payloadHash: string; receipt: TransactionReceipt }>;
    }
  >();

  constructor() {
    this.txVisibilityDecider = this.resolveTxVisibilityDecider();
  }

  private getSpaceState(graphSpaceId: string): {
    meta: EventEnvelope[];
    graph: EventEnvelope[];
    txIndex: TxIndexEntry[];
    txById: Map<TxId, TxIndexEntry>;
    idempotency: Map<string, { payloadHash: string; receipt: TransactionReceipt }>;
  } {
    return (
      this.bySpace.get(graphSpaceId) ?? {
        meta: [],
        graph: [],
        txIndex: [],
        txById: new Map(),
        idempotency: new Map()
      }
    );
  }

  async appendTx(
    graphSpaceId: string,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx,
    hooks?: FaultInjectionHooks
  ): Promise<TransactionReceipt | CommandError> {
    if (txBundle.metaEvents.length === 0 && txBundle.graphEvents.length === 0) {
      return {
        status: "rejected",
        category: "VALIDATION",
        reasonCode: REASON_CODES.EMPTY_TX
      };
    }

    const current = this.getSpaceState(graphSpaceId);
    const idempotencySlot = `${idempotencyCtx.actorId}::${idempotencyCtx.idempotencyKey}`;
    const existing = current.idempotency.get(idempotencySlot);
    if (existing) {
      if (existing.payloadHash !== idempotencyCtx.payloadHash) {
        return {
          status: "rejected",
          category: "CONFLICT",
          reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH
        };
      }
      return existing.receipt;
    }

    this.hitHook(hooks, "BEFORE_ANY_WRITE");

    const metaStart = current.meta.length;
    const graphStart = current.graph.length;

    const meta = txBundle.metaEvents.map((payload, idx) => ({
      graphSpaceId,
      stream: "meta" as const,
      seq: metaStart + idx + 1,
      txId: txBundle.txId,
      eventId: `${txBundle.txId}-m-${idx + 1}`,
      payload
    }));

    const graph = txBundle.graphEvents.map((payload, idx) => ({
      graphSpaceId,
      stream: "graph" as const,
      seq: graphStart + idx + 1,
      txId: txBundle.txId,
      eventId: `${txBundle.txId}-g-${idx + 1}`,
      payload
    }));

    this.hitHook(hooks, "AFTER_META_EVENTS");
    this.hitHook(hooks, "AFTER_GRAPH_EVENTS");

    const txIndexEntry: TxIndexEntry = {
      txId: txBundle.txId,
      txIndex: current.txIndex.length + 1,
      meta: {
        start: meta.length > 0 ? meta[0].seq : metaStart,
        end: meta.length > 0 ? meta[meta.length - 1].seq : metaStart,
        count: meta.length
      },
      graph: {
        start: graph.length > 0 ? graph[0].seq : graphStart,
        end: graph.length > 0 ? graph[graph.length - 1].seq : graphStart,
        count: graph.length
      }
    };

    this.hitHook(hooks, "AFTER_TX_INDEX");
    this.hitHook(hooks, "AFTER_HEADS_UPDATE");

    const receipt: TransactionReceipt = {
      status: "committed",
      commandId: txBundle.txId,
      txId: txBundle.txId,
      txIndex: txIndexEntry.txIndex,
      cursorAfter: { metaSeq: metaStart + meta.length, graphSeq: graphStart + graph.length },
      eventRefs: {
        meta: meta.map((e) => ({ stream: e.stream, seq: e.seq, eventId: e.eventId })),
        graph: graph.map((e) => ({ stream: e.stream, seq: e.seq, eventId: e.eventId }))
      }
    };

    this.hitHook(hooks, "AFTER_IDEMPOTENCY_UPSERT");
    this.hitHook(hooks, "BEFORE_IDB_COMMIT");

    current.meta.push(...meta);
    current.graph.push(...graph);
    current.txIndex.push(txIndexEntry);
    current.txById.set(txBundle.txId, txIndexEntry);
    current.idempotency.set(idempotencySlot, {
      payloadHash: idempotencyCtx.payloadHash,
      receipt
    });
    this.bySpace.set(graphSpaceId, current);

    return receipt;
  }

  async readTx(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return null;
    const meta = current.meta.filter((e) => e.txId === txId);
    const graph = current.graph.filter((e) => e.txId === txId);
    if (meta.length === 0 && graph.length === 0) return null;
    return { txId, meta, graph };
  }

  async readTxForPrincipal(
    graphSpaceId: string,
    txId: TxId,
    principal?: PrincipalContext
  ): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError> {
    const tx = await this.readTx(graphSpaceId, txId);
    if (!tx) {
      return this.notFoundOrMasked();
    }
    return this.txVisibilityDecider.decideTxVisibility(toVisibilityContext(principal), { txId, txIndex: 0, meta: tx.meta, graph: tx.graph }) ===
      "allow"
      ? tx
      : this.notFoundOrMasked();
  }

  async readRange(
    graphSpaceId: string,
    stream: StreamName,
    fromSeqExclusive: number,
    limit: number,
    _mode: ReadMode,
    options?: ReadRangeOptions
  ): Promise<EventEnvelope[]> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return [];

    const snapshotCap = options?.snapshotCursor?.[stream === "meta" ? "metaSeq" : "graphSeq"];
    const visible = current[stream].filter((e) => e.seq > fromSeqExclusive && (snapshotCap === undefined || e.seq <= snapshotCap));
    if (visible.length <= limit) {
      return visible;
    }

    const initial = visible.slice(0, limit);
    const last = initial[initial.length - 1];
    if (!last) return initial;

    const boundary = current.txById.get(last.txId);
    if (!boundary) return initial;
    const txEndSeq = boundary[stream].end;
    if (last.seq >= txEndSeq) {
      return initial;
    }

    const extended = visible.filter((e) => e.seq <= txEndSeq);
    return extended;
  }

  async readTxIndex(graphSpaceId: string): Promise<TxIndexEntry[]> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return [];
    return [...current.txIndex];
  }

  async getCursorHead(graphSpaceId: string): Promise<Cursor> {
    const current = this.bySpace.get(graphSpaceId);
    return {
      metaSeq: current?.meta.length ?? 0,
      graphSeq: current?.graph.length ?? 0
    };
  }

  async readPrincipalTxRange(
    graphSpaceId: string,
    fromPrincipalCursorExclusive: number,
    limit: number,
    principal?: PrincipalContext
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) {
      return { txs: [], cursor: fromPrincipalCursorExclusive };
    }

    const txs = buildTxBundles(current.txIndex, current.meta, current.graph);
    return filterVisibleTxs({
      txs,
      fromPrincipalCursorExclusive,
      limit,
      visibility: toVisibilityContext(principal),
      decider: this.txVisibilityDecider
    });
  }

  async getPrincipalCursorHead(graphSpaceId: string, principal?: PrincipalContext): Promise<number> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return 0;
    const txs = buildTxBundles(current.txIndex, current.meta, current.graph);
    return countVisibleTxs(txs, toVisibilityContext(principal), this.txVisibilityDecider);
  }

  async resolveRevision(_graphSpaceId: string, _revisionToken: string): Promise<Cursor | null> {
    return null;
  }

  async compactUpToCursor(params: { graphSpaceId: string; cursorExclusive: number }): Promise<void> {
    const current = this.bySpace.get(params.graphSpaceId);
    if (!current) return;

    const cutoff = Math.max(0, params.cursorExclusive);
    const prunedTxIds = new Set(current.txIndex.filter((entry) => entry.txIndex < cutoff).map((entry) => entry.txId));
    if (prunedTxIds.size === 0) return;

    current.txIndex = current.txIndex.filter((entry) => !prunedTxIds.has(entry.txId));
    current.meta = current.meta.filter((event) => !prunedTxIds.has(event.txId));
    current.graph = current.graph.filter((event) => !prunedTxIds.has(event.txId));
    current.txById = new Map(current.txIndex.map((entry) => [entry.txId, entry]));
    this.bySpace.set(params.graphSpaceId, current);
  }

  private notFoundOrMasked(): CommandError {
    return {
      status: "rejected",
      category: "NOT_FOUND",
      reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED
    };
  }

  private resolveTxVisibilityDecider(): TxVisibilityDecider {
    const mode = process.env.MESH_TX_VISIBILITY_POLICY;
    if (mode === "acl") {
      return createAclTxVisibilityDecider();
    }
    if (mode === "entity-secret") {
      return createEntitySecretMaskDecider();
    }
    return createDefaultTxVisibilityDecider();
  }

  private hitHook(hooks: FaultInjectionHooks | undefined, point: Parameters<NonNullable<FaultInjectionHooks["onPoint"]>>[0]): void {
    hooks?.onPoint?.(point);
    if (hooks?.failAt === point) {
      throw new Error(`FAULT_INJECTION:${point}`);
    }
  }
}

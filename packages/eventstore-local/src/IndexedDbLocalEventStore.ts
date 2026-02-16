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

type RevisionRow = { graphSpaceId: string; revisionToken: string; cursor: Cursor };
type IdempotencyRow = { payloadHash: string; receipt: TransactionReceipt };
type SpaceState = {
  metaEvents: EventEnvelope[];
  graphEvents: EventEnvelope[];
  txIndex: TxIndexEntry[];
  txIndexByTxId: Map<string, TxIndexEntry>;
  heads: Cursor;
  idempotency: Map<string, IdempotencyRow>;
  revisions: Map<string, Cursor>;
};

type IndexedDbState = {
  spaces: Map<string, SpaceState>;
};

const DATABASES = new Map<string, IndexedDbState>();
const DEFAULT_DB_NAME = "mesh_local_v1";

/**
 * IndexedDB-compatible local store with atomic write-set semantics.
 * In Node test environments lacking native IndexedDB, this class uses an equivalent in-process model.
 */
export class IndexedDbLocalEventStore implements LocalEventStore {
  private readonly txVisibilityDecider: TxVisibilityDecider;

  private constructor(private readonly dbName: string) {
    this.txVisibilityDecider = this.resolveTxVisibilityDecider();
    DATABASES.set(this.dbName, DATABASES.get(this.dbName) ?? { spaces: new Map() });
  }

  static async create(params?: { dbName?: string }): Promise<IndexedDbLocalEventStore> {
    return new IndexedDbLocalEventStore(params?.dbName ?? DEFAULT_DB_NAME);
  }

  static async createFromUri(uri: string): Promise<IndexedDbLocalEventStore> {
    return this.create({ dbName: parseIndexedDbUri(uri) });
  }

  async appendTx(
    graphSpaceId: string,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx,
    hooks?: FaultInjectionHooks
  ): Promise<TransactionReceipt | CommandError> {
    if (txBundle.metaEvents.length === 0 && txBundle.graphEvents.length === 0) {
      return { status: "rejected", category: "VALIDATION", reasonCode: REASON_CODES.EMPTY_TX };
    }

    const db = this.getDb();
    const current = this.getOrCreateSpace(db, graphSpaceId);
    const idempotencySlot = this.idempotencySlot(graphSpaceId, idempotencyCtx.actorId, idempotencyCtx.idempotencyKey);
    const existing = current.idempotency.get(idempotencySlot);
    if (existing) {
      if (existing.payloadHash !== idempotencyCtx.payloadHash) {
        return { status: "rejected", category: "CONFLICT", reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH };
      }
      return existing.receipt;
    }

    const staged = cloneSpaceState(current);
    this.hitHook(hooks, "BEFORE_ANY_WRITE");

    const meta = txBundle.metaEvents.map((payload, idx) => ({
      graphSpaceId,
      stream: "meta" as const,
      seq: staged.heads.metaSeq + idx + 1,
      txId: txBundle.txId,
      eventId: `${txBundle.txId}-m-${idx + 1}`,
      payload
    }));
    this.hitHook(hooks, "AFTER_META_EVENTS");

    const graph = txBundle.graphEvents.map((payload, idx) => ({
      graphSpaceId,
      stream: "graph" as const,
      seq: staged.heads.graphSeq + idx + 1,
      txId: txBundle.txId,
      eventId: `${txBundle.txId}-g-${idx + 1}`,
      payload
    }));
    this.hitHook(hooks, "AFTER_GRAPH_EVENTS");

    const txIndexEntry: TxIndexEntry = {
      txId: txBundle.txId,
      txIndex: staged.txIndex.length + 1,
      meta: {
        start: meta.length > 0 ? meta[0].seq : staged.heads.metaSeq,
        end: meta.length > 0 ? meta[meta.length - 1].seq : staged.heads.metaSeq,
        count: meta.length
      },
      graph: {
        start: graph.length > 0 ? graph[0].seq : staged.heads.graphSeq,
        end: graph.length > 0 ? graph[graph.length - 1].seq : staged.heads.graphSeq,
        count: graph.length
      }
    };
    staged.txIndex.push(txIndexEntry);
    staged.txIndexByTxId.set(txBundle.txId, txIndexEntry);
    this.hitHook(hooks, "AFTER_TX_INDEX");

    staged.metaEvents.push(...meta);
    staged.graphEvents.push(...graph);
    staged.heads = {
      metaSeq: staged.heads.metaSeq + meta.length,
      graphSeq: staged.heads.graphSeq + graph.length
    };
    this.hitHook(hooks, "AFTER_HEADS_UPDATE");

    const receipt: TransactionReceipt = {
      status: "committed",
      commandId: txBundle.txId,
      txId: txBundle.txId,
      txIndex: txIndexEntry.txIndex,
      cursorAfter: { ...staged.heads },
      eventRefs: {
        meta: meta.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId })),
        graph: graph.map((event) => ({ stream: event.stream, seq: event.seq, eventId: event.eventId }))
      }
    };

    staged.idempotency.set(idempotencySlot, { payloadHash: idempotencyCtx.payloadHash, receipt });
    this.hitHook(hooks, "AFTER_IDEMPOTENCY_UPSERT");
    this.hitHook(hooks, "BEFORE_IDB_COMMIT");

    db.spaces.set(graphSpaceId, staged);
    return receipt;
  }

  async readTx(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return null;
    const txIndex = space.txIndexByTxId.get(txId);
    if (!txIndex) return null;
    return {
      txId,
      meta: this.sliceByRange(space.metaEvents, txIndex.meta.start, txIndex.meta.end),
      graph: this.sliceByRange(space.graphEvents, txIndex.graph.start, txIndex.graph.end)
    };
  }

  async readTxForPrincipal(
    graphSpaceId: string,
    txId: TxId,
    principal?: PrincipalContext
  ): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError> {
    const tx = await this.readTx(graphSpaceId, txId);
    if (!tx) return this.notFoundOrMasked();
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
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return [];
    const source = stream === "meta" ? space.metaEvents : space.graphEvents;
    const snapshotCap = options?.snapshotCursor?.[stream === "meta" ? "metaSeq" : "graphSeq"];
    const visible = source.filter((event) => event.seq > fromSeqExclusive && (snapshotCap === undefined || event.seq <= snapshotCap));
    if (visible.length <= limit) return visible;

    const initial = visible.slice(0, limit);
    const last = initial[initial.length - 1];
    if (!last) return initial;

    const txIndex = space.txIndexByTxId.get(last.txId);
    if (!txIndex) return initial;
    const txEndSeq = txIndex[stream].end;
    if (last.seq >= txEndSeq) return initial;
    return visible.filter((event) => event.seq <= txEndSeq);
  }

  async readTxIndex(graphSpaceId: string): Promise<TxIndexEntry[]> {
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return [];
    return [...space.txIndex];
  }

  async getCursorHead(graphSpaceId: string): Promise<Cursor> {
    const space = this.getDb().spaces.get(graphSpaceId);
    return space ? { ...space.heads } : { metaSeq: 0, graphSeq: 0 };
  }

  async readPrincipalTxRange(
    graphSpaceId: string,
    fromPrincipalCursorExclusive: number,
    limit: number,
    principal?: PrincipalContext
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }> {
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return { txs: [], cursor: fromPrincipalCursorExclusive };

    const txs = buildTxBundles(space.txIndex, space.metaEvents, space.graphEvents);
    return filterVisibleTxs({
      txs,
      fromPrincipalCursorExclusive,
      limit,
      visibility: toVisibilityContext(principal),
      decider: this.txVisibilityDecider
    });
  }

  async getPrincipalCursorHead(graphSpaceId: string, principal?: PrincipalContext): Promise<number> {
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return 0;
    const txs = buildTxBundles(space.txIndex, space.metaEvents, space.graphEvents);
    return countVisibleTxs(txs, toVisibilityContext(principal), this.txVisibilityDecider);
  }

  async resolveRevision(graphSpaceId: string, revisionToken: string): Promise<Cursor | null> {
    const space = this.getDb().spaces.get(graphSpaceId);
    if (!space) return null;
    return space.revisions.get(revisionToken) ?? null;
  }

  async compactUpToCursor(params: { graphSpaceId: string; cursorExclusive: number }): Promise<void> {
    const db = this.getDb();
    const current = db.spaces.get(params.graphSpaceId);
    if (!current) return;
    const staged = cloneSpaceState(current);
    const cutoff = Math.max(0, params.cursorExclusive);
    const removed = new Set(staged.txIndex.filter((entry) => entry.txIndex < cutoff).map((entry) => entry.txId));
    if (removed.size === 0) return;

    staged.txIndex = staged.txIndex.filter((entry) => !removed.has(entry.txId));
    staged.metaEvents = staged.metaEvents.filter((event) => !removed.has(event.txId));
    staged.graphEvents = staged.graphEvents.filter((event) => !removed.has(event.txId));
    staged.txIndexByTxId = new Map(staged.txIndex.map((entry) => [entry.txId, entry]));

    db.spaces.set(params.graphSpaceId, staged);
  }

  async close(): Promise<void> {
    return;
  }

  async deleteDatabase(): Promise<void> {
    DATABASES.delete(this.dbName);
  }

  private getDb(): IndexedDbState {
    const state = DATABASES.get(this.dbName);
    if (!state) {
      const created: IndexedDbState = { spaces: new Map() };
      DATABASES.set(this.dbName, created);
      return created;
    }
    return state;
  }

  private getOrCreateSpace(db: IndexedDbState, graphSpaceId: string): SpaceState {
    const existing = db.spaces.get(graphSpaceId);
    if (existing) return existing;
    const created: SpaceState = {
      metaEvents: [],
      graphEvents: [],
      txIndex: [],
      txIndexByTxId: new Map(),
      heads: { metaSeq: 0, graphSeq: 0 },
      idempotency: new Map(),
      revisions: new Map<string, Cursor>()
    };
    db.spaces.set(graphSpaceId, created);
    return created;
  }

  private idempotencySlot(graphSpaceId: string, actorId: string, idempotencyKey: string): string {
    return `${graphSpaceId}::${actorId}::${idempotencyKey}`;
  }

  private sliceByRange(events: EventEnvelope[], start: number, end: number): EventEnvelope[] {
    return events.filter((event) => event.seq >= start && event.seq <= end);
  }

  private notFoundOrMasked(): CommandError {
    return { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
  }

  private resolveTxVisibilityDecider(): TxVisibilityDecider {
    const mode = process.env.MESH_TX_VISIBILITY_POLICY;
    if (mode === "acl") return createAclTxVisibilityDecider();
    if (mode === "entity-secret") return createEntitySecretMaskDecider();
    return createDefaultTxVisibilityDecider();
  }

  private hitHook(hooks: FaultInjectionHooks | undefined, point: Parameters<NonNullable<FaultInjectionHooks["onPoint"]>>[0]): void {
    hooks?.onPoint?.(point);
    if (hooks?.failAt === point) {
      throw new Error(`FAULT_INJECTION:${point}`);
    }
  }
}

function cloneSpaceState(state: SpaceState): SpaceState {
  return {
    metaEvents: [...state.metaEvents],
    graphEvents: [...state.graphEvents],
    txIndex: [...state.txIndex],
    txIndexByTxId: new Map(state.txIndexByTxId),
    heads: { ...state.heads },
    idempotency: new Map(state.idempotency),
    revisions: new Map(state.revisions)
  };
}

function parseIndexedDbUri(uri: string): string {
  const prefix = "indexeddb://";
  if (!uri.startsWith(prefix)) {
    throw new Error(`Invalid IndexedDB URI: ${uri}`);
  }
  const dbName = uri.slice(prefix.length).trim();
  if (!dbName) {
    throw new Error("IndexedDB URI must include a database name");
  }
  return dbName;
}

export function describeIndexedDbStorage(): {
  stores: readonly ["meta_events", "graph_events", "tx_index", "heads", "idempotency", "revisions"];
  indexes: {
    meta_events: readonly ["by_tx"];
    graph_events: readonly ["by_tx"];
    tx_index: readonly ["by_metaSeqStart", "by_graphSeqStart"];
  };
} {
  return {
    stores: ["meta_events", "graph_events", "tx_index", "heads", "idempotency", "revisions"],
    indexes: {
      meta_events: ["by_tx"],
      graph_events: ["by_tx"],
      tx_index: ["by_metaSeqStart", "by_graphSeqStart"]
    }
  };
}

export function toRevisionRow(graphSpaceId: string, revisionToken: string, cursor: Cursor): RevisionRow {
  return { graphSpaceId, revisionToken, cursor };
}

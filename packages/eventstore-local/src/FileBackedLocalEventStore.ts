import { promises as fs } from "node:fs";
import { IndexedDbLocalEventStore } from "./IndexedDbLocalEventStore.js";
import path from "node:path";
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
import { recordEventsScanned, recordRangeRead, recordTxIndexLookup } from "./internal/readCost.js";

type SpaceState = {
  meta: EventEnvelope[];
  graph: EventEnvelope[];
  txIndex: TxIndexEntry[];
  idempotency: Record<string, { payloadHash: string; receipt: TransactionReceipt }>;
};

type PersistedState = {
  spaces: Record<string, SpaceState>;
};

const EMPTY_STATE: PersistedState = { spaces: {} };

/**
 * Node-only minimal persistent implementation for conformance runs.
 */
export class FileBackedLocalEventStore implements LocalEventStore {
  private readonly filePath: string;
  private readonly txVisibilityDecider: TxVisibilityDecider;
  private state: PersistedState | null = null;
  private readonly txIndexBySpace = new Map<string, Map<TxId, TxIndexEntry>>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.txVisibilityDecider = this.resolveTxVisibilityDecider();
  }

  async appendTx(
    graphSpaceId: string,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx,
    hooks?: FaultInjectionHooks
  ): Promise<TransactionReceipt | CommandError> {
    await this.loadState();

    if (txBundle.metaEvents.length === 0 && txBundle.graphEvents.length === 0) {
      return { status: "rejected", category: "VALIDATION", reasonCode: REASON_CODES.EMPTY_TX };
    }

    const space = this.ensureSpace(graphSpaceId);
    const idempotencySlot = `${idempotencyCtx.actorId}::${idempotencyCtx.idempotencyKey}`;
    const existing = space.idempotency[idempotencySlot];
    if (existing) {
      if (existing.payloadHash !== idempotencyCtx.payloadHash) {
        return { status: "rejected", category: "CONFLICT", reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH };
      }
      return existing.receipt;
    }

    this.hitHook(hooks, "BEFORE_ANY_WRITE");

    const metaStart = space.meta.length;
    const graphStart = space.graph.length;

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
      txIndex: space.txIndex.length + 1,
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

    space.meta.push(...meta);
    space.graph.push(...graph);
    space.txIndex.push(txIndexEntry);
    this.txIndexBySpace.delete(graphSpaceId);
    space.idempotency[idempotencySlot] = { payloadHash: idempotencyCtx.payloadHash, receipt };

    await this.persistState();
    return receipt;
  }

  async readTx(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    if (!space) return null;
    recordTxIndexLookup();
    const txIndex = this.getTxIndexById(graphSpaceId, space).get(txId);
    if (!txIndex) return null;
    const meta = this.sliceBySeqRange(space.meta, txIndex.meta.start, txIndex.meta.end);
    const graph = this.sliceBySeqRange(space.graph, txIndex.graph.start, txIndex.graph.end);
    recordEventsScanned(meta.length + graph.length);
    return { txId, meta, graph };
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
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    if (!space) return [];
    recordRangeRead();

    const source = stream === "meta" ? space.meta : space.graph;
    const snapshotCap = options?.snapshotCursor?.[stream === "meta" ? "metaSeq" : "graphSeq"];
    const bounded = this.sliceBySeqBounds(source, fromSeqExclusive + 1, snapshotCap);
    if (bounded.length <= limit) {
      recordEventsScanned(bounded.length);
      return bounded;
    }

    const initial = bounded.slice(0, limit);
    const last = initial[initial.length - 1];
    if (!last) return initial;

    recordTxIndexLookup();
    const boundary = this.getTxIndexById(graphSpaceId, space).get(last.txId);
    if (!boundary) return initial;
    const txEndSeq = boundary[stream].end;
    if (last.seq >= txEndSeq) {
      recordEventsScanned(initial.length);
      return initial;
    }
    const extended = this.sliceBySeqBounds(source, fromSeqExclusive + 1, Math.min(snapshotCap ?? Number.MAX_SAFE_INTEGER, txEndSeq));
    recordEventsScanned(extended.length);
    return extended;
  }

  async readTxIndex(graphSpaceId: string): Promise<TxIndexEntry[]> {
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    return space ? [...space.txIndex] : [];
  }

  async getCursorHead(graphSpaceId: string): Promise<Cursor> {
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    return { metaSeq: space?.meta.length ?? 0, graphSeq: space?.graph.length ?? 0 };
  }

  async readPrincipalTxRange(
    graphSpaceId: string,
    fromPrincipalCursorExclusive: number,
    limit: number,
    principal?: PrincipalContext
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }> {
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    if (!space) return { txs: [], cursor: fromPrincipalCursorExclusive };

    const txs = buildTxBundles(space.txIndex, space.meta, space.graph);
    return filterVisibleTxs({
      txs,
      fromPrincipalCursorExclusive,
      limit,
      visibility: toVisibilityContext(principal),
      decider: this.txVisibilityDecider
    });
  }

  async getPrincipalCursorHead(graphSpaceId: string, principal?: PrincipalContext): Promise<number> {
    await this.loadState();
    const space = this.getSpace(graphSpaceId);
    if (!space) return 0;
    const txs = buildTxBundles(space.txIndex, space.meta, space.graph);
    return countVisibleTxs(txs, toVisibilityContext(principal), this.txVisibilityDecider);
  }

  async resolveRevision(_graphSpaceId: string, _revisionToken: string): Promise<Cursor | null> {
    return null;
  }

  async compactUpToCursor(params: { graphSpaceId: string; cursorExclusive: number }): Promise<void> {
    await this.loadState();
    const space = this.getSpace(params.graphSpaceId);
    if (!space) return;

    const cutoff = Math.max(0, params.cursorExclusive);
    const prunedTxIds = new Set(space.txIndex.filter((entry) => entry.txIndex < cutoff).map((entry) => entry.txId));
    if (prunedTxIds.size === 0) return;

    space.txIndex = space.txIndex.filter((entry) => !prunedTxIds.has(entry.txId));
    space.meta = space.meta.filter((event) => !prunedTxIds.has(event.txId));
    space.graph = space.graph.filter((event) => !prunedTxIds.has(event.txId));
    this.txIndexBySpace.delete(params.graphSpaceId);
    await this.persistState();
  }

  async close(): Promise<void> {
    // No open file descriptors to release.
  }

  private async loadState(): Promise<PersistedState> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as PersistedState;
      this.txIndexBySpace.clear();
    } catch (error) {
      const nodeError = error as { code?: string };
      if (nodeError.code === "ENOENT") {
        this.state = { spaces: {} };
        this.txIndexBySpace.clear();
      } else {
        throw error;
      }
    }
    return this.state;
  }

  private async persistState(): Promise<void> {
    const state = await this.loadState();
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  private getSpace(graphSpaceId: string): SpaceState | undefined {
    const state = this.state ?? EMPTY_STATE;
    return state.spaces[graphSpaceId];
  }

  private ensureSpace(graphSpaceId: string): SpaceState {
    if (!this.state) {
      throw new Error("Store state not loaded");
    }
    this.state.spaces[graphSpaceId] ??= { meta: [], graph: [], txIndex: [], idempotency: {} };
    return this.state.spaces[graphSpaceId];
  }

  private notFoundOrMasked(): CommandError {
    return { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
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
    if (hooks?.failAt === point) throw new Error(`FAULT_INJECTION:${point}`);
  }

  private getTxIndexById(graphSpaceId: string, space: SpaceState): Map<TxId, TxIndexEntry> {
    const existing = this.txIndexBySpace.get(graphSpaceId);
    if (existing && existing.size === space.txIndex.length) {
      return existing;
    }
    const rebuilt = new Map(space.txIndex.map((entry) => [entry.txId, entry]));
    this.txIndexBySpace.set(graphSpaceId, rebuilt);
    return rebuilt;
  }

  private sliceBySeqRange(events: EventEnvelope[], start: number, end: number): EventEnvelope[] {
    if (start > end || events.length === 0) {
      return [];
    }
    return events.slice(Math.max(0, start - 1), Math.min(events.length, end));
  }

  private sliceBySeqBounds(events: EventEnvelope[], startInclusive: number, endInclusive?: number): EventEnvelope[] {
    if (events.length === 0) {
      return [];
    }
    const startIndex = Math.max(0, startInclusive - 1);
    const lastSeq = endInclusive ?? events.length;
    if (lastSeq < startInclusive) {
      return [];
    }
    return events.slice(startIndex, Math.min(events.length, lastSeq));
  }

  static async open(filePath: string): Promise<FileBackedLocalEventStore> {
    const store = new FileBackedLocalEventStore(filePath);
    await store.loadState();
    return store;
  }
}

export async function makePersistentEventStore(filePath: string): Promise<LocalEventStore> {
  if (filePath.startsWith("indexeddb://")) {
    return IndexedDbLocalEventStore.createFromUri(filePath);
  }
  return FileBackedLocalEventStore.open(filePath);
}

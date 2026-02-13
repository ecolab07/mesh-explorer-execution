import type {
  CommandError,
  Cursor,
  EventEnvelope,
  IdempotencyCtx,
  ReadMode,
  StreamName,
  TransactionReceipt,
  TxBundle,
  TxId
} from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import type { LocalEventStore } from "./LocalEventStore.js";

/**
 * Non-conformant stub for Phase 9 bootstrap only.
 * spec-ref: §2.4 requires tx-closed extension behavior; this stub does NOT fully implement normative guarantees.
 */
export class InMemoryLocalEventStore implements LocalEventStore {
  private readonly bySpace = new Map<string, { meta: EventEnvelope[]; graph: EventEnvelope[] }>();

  async appendTx(graphSpaceId: string, txBundle: TxBundle, _idempotencyCtx: IdempotencyCtx): Promise<TransactionReceipt | CommandError> {
    if (txBundle.metaEvents.length === 0 && txBundle.graphEvents.length === 0) {
      return {
        status: "rejected",
        category: "VALIDATION",
        reasonCode: REASON_CODES.EMPTY_TX
      };
    }

    const current = this.bySpace.get(graphSpaceId) ?? { meta: [], graph: [] };
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

    current.meta.push(...meta);
    current.graph.push(...graph);
    this.bySpace.set(graphSpaceId, current);

    return {
      status: "committed",
      commandId: txBundle.txId,
      txId: txBundle.txId,
      cursorAfter: { metaSeq: current.meta.length, graphSeq: current.graph.length },
      eventRefs: {
        meta: meta.map((e) => ({ stream: e.stream, seq: e.seq, eventId: e.eventId })),
        graph: graph.map((e) => ({ stream: e.stream, seq: e.seq, eventId: e.eventId }))
      }
    };
  }

  async readTx(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return null;
    const meta = current.meta.filter((e) => e.txId === txId);
    const graph = current.graph.filter((e) => e.txId === txId);
    if (meta.length === 0 && graph.length === 0) return null;
    return { txId, meta, graph };
  }

  async readRange(graphSpaceId: string, stream: StreamName, fromSeqExclusive: number, limit: number, _mode: ReadMode): Promise<EventEnvelope[]> {
    const current = this.bySpace.get(graphSpaceId);
    if (!current) return [];
    return current[stream].filter((e) => e.seq > fromSeqExclusive).slice(0, limit);
  }

  async getCursorHead(graphSpaceId: string): Promise<Cursor> {
    const current = this.bySpace.get(graphSpaceId);
    return {
      metaSeq: current?.meta.length ?? 0,
      graphSeq: current?.graph.length ?? 0
    };
  }

  async resolveRevision(_graphSpaceId: string, _revisionToken: string): Promise<Cursor | null> {
    // TODO(spec-ref: §3.3, §11.4): implement opaque revision token resolution.
    return null;
  }
}

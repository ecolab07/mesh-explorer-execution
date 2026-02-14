import type { LocalEventStore } from "@mesh/eventstore-local";
import type { GraphSpaceId } from "@mesh/shared";
import { stripNondeterminism } from "@mesh/shared";

/** spec-ref: Mesh_Execution_Compiled_v_1.md §16.1 */
export interface CanonicalStateDump {
  version: "CSD-ES-1";
  graphSpaceId: string;
  cursorHead: { metaSeq: number; graphSeq: number };
  streams: {
    meta: CanonicalEventDump[];
    graph: CanonicalEventDump[];
  };
  txIndex: CanonicalTxIndexDump[];
}

export interface CanonicalEventDump {
  stream: "meta" | "graph";
  seq: number;
  txId: string;
  eventId: string;
  payload: Record<string, unknown>;
}

export interface CanonicalTxIndexDump {
  txId: string;
  meta: { start: number; end: number; count: number };
  graph: { start: number; end: number; count: number };
}

/** spec-ref: §16.2 */
export async function buildCanonicalStateDump(eventStore: LocalEventStore, graphSpaceId: GraphSpaceId): Promise<CanonicalStateDump> {
  const cursorHead = await eventStore.getCursorHead(graphSpaceId);
  const metaEvents = await eventStore.readRange(graphSpaceId, "meta", 0, Number.MAX_SAFE_INTEGER, "TX_CLOSED");
  const graphEvents = await eventStore.readRange(graphSpaceId, "graph", 0, Number.MAX_SAFE_INTEGER, "TX_CLOSED");

  // TODO(spec-ref: §16.2 step 5): LocalEventStore interface has no tx_index read API in this phase scaffold.
  const txIndex: CanonicalTxIndexDump[] = [];

  return {
    version: "CSD-ES-1",
    graphSpaceId,
    cursorHead,
    streams: {
      meta: metaEvents.map((e) => ({ stream: "meta", seq: e.seq, txId: e.txId, eventId: e.eventId, payload: stripNondeterminism(e.payload) })),
      graph: graphEvents.map((e) => ({ stream: "graph", seq: e.seq, txId: e.txId, eventId: e.eventId, payload: stripNondeterminism(e.payload) }))
    },
    txIndex
  };
}

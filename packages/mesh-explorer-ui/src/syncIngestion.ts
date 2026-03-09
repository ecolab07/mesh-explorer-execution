import { compareCursor } from "./syncGuards.js";
import type { GraphEvent } from "./graphStore.js";

export type Cursor = { metaSeq: number; graphSeq: number };

export type IngestibleGraphEvent = { eventId: string; event: GraphEvent };

export type SyncIngestionState = {
  cursor: Cursor;
  seenEventIdsByGraphSpace: Map<string, Set<string>>;
};

export type SyncIngestionResult = {
  appliedCount: number;
  duplicateCount: number;
  cursorAdvanced: boolean;
  nextCursor: Cursor;
};

export function applyGuardedSyncBatch(params: {
  graphSpaceId: string;
  state: SyncIngestionState;
  source: "poll" | "sse" | "replay";
  candidateCursor: Cursor;
  events: IngestibleGraphEvent[];
  applyGraphEvents: (events: GraphEvent[]) => void;
  log: (message: string, detail: Record<string, unknown>) => void;
}): SyncIngestionResult {
  const { graphSpaceId, state, source, candidateCursor, events, applyGraphEvents, log } = params;
  if (compareCursor(candidateCursor, state.cursor) <= 0) {
    log("SYNC_STALE_BATCH_IGNORED", { source, graphSpaceId, current: state.cursor, candidate: candidateCursor, events: events.length });
    return { appliedCount: 0, duplicateCount: 0, cursorAdvanced: false, nextCursor: state.cursor };
  }

  const seen = ensureGraphSpaceDedup(state.seenEventIdsByGraphSpace, graphSpaceId);
  const uniqueEvents: GraphEvent[] = [];
  let duplicateCount = 0;

  for (const entry of events) {
    if (seen.has(entry.eventId)) {
      duplicateCount += 1;
      log("SYNC_DUPLICATE_EVENT_IGNORED", { source, graphSpaceId, eventId: entry.eventId });
      continue;
    }
    seen.add(entry.eventId);
    uniqueEvents.push(entry.event);
  }

  if (uniqueEvents.length > 0) {
    applyGraphEvents(uniqueEvents);
    log("SYNC_EVENTS_APPLIED", { source, graphSpaceId, appliedCount: uniqueEvents.length, duplicateCount });
  }

  const previousCursor = state.cursor;
  state.cursor = candidateCursor;
  log("SYNC_CURSOR_ADVANCED", { source, graphSpaceId, previousCursor, nextCursor: candidateCursor });

  return {
    appliedCount: uniqueEvents.length,
    duplicateCount,
    cursorAdvanced: true,
    nextCursor: candidateCursor
  };
}

export function ensureGraphSpaceDedup(map: Map<string, Set<string>>, graphSpaceId: string): Set<string> {
  const existing = map.get(graphSpaceId);
  if (existing) return existing;
  const created = new Set<string>();
  map.set(graphSpaceId, created);
  return created;
}

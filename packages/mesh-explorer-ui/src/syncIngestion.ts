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
  source: "poll" | "subscribe" | "pull";
  candidateCursor: Cursor;
  events: IngestibleGraphEvent[];
  applyGraphEvents: (events: GraphEvent[]) => void;
  log: (message: string, detail: Record<string, unknown>) => void;
}): SyncIngestionResult {
  const { graphSpaceId, state, source, candidateCursor, events, applyGraphEvents, log } = params;
  if (compareCursor(candidateCursor, state.cursor) <= 0) {
    log("GHOST_GUARD_STALE_BATCH", { source, graphSpaceId, current: state.cursor, candidate: candidateCursor, events: events.length });
    return { appliedCount: 0, duplicateCount: 0, cursorAdvanced: false, nextCursor: state.cursor };
  }

  const seen = ensureGraphSpaceDedup(state.seenEventIdsByGraphSpace, graphSpaceId);
  const uniqueEvents: GraphEvent[] = [];
  let duplicateCount = 0;

  for (const entry of events) {
    if (seen.has(entry.eventId)) {
      duplicateCount += 1;
      log("GHOST_GUARD_DUPLICATE_IGNORED", { source, graphSpaceId, eventId: entry.eventId });
      continue;
    }
    seen.add(entry.eventId);
    uniqueEvents.push(entry.event);
    log("GHOST_GUARD_EVENT_APPLIED", { source, graphSpaceId, eventId: entry.eventId });
  }

  if (uniqueEvents.length > 0) {
    applyGraphEvents(uniqueEvents);
  }

  log("GHOST_GUARD_BATCH_PROCESSED", {
    source,
    graphSpaceId,
    receivedCount: events.length,
    appliedCount: uniqueEvents.length,
    duplicateCount
  });

  const previousCursor = state.cursor;
  state.cursor = candidateCursor;
  log("GHOST_GUARD_CURSOR_ADVANCE", { source, graphSpaceId, previousCursor, nextCursor: candidateCursor });

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

import type { Cursor } from "./graphStore.js";
import { compareCursor } from "./syncGuards.js";

export const ZERO_CURSOR: Cursor = { metaSeq: 0, graphSeq: 0 };

type StoreSnapshot = { cursor?: Cursor | null };

export function resolveBootstrapFromCursor(saved: Cursor | null, snapshot: StoreSnapshot): Cursor {
  const normalizedSaved = normalizeCursor(saved);
  const normalizedSnapshot = normalizeCursor(snapshot.cursor ?? null);
  return compareCursor(normalizedSaved, normalizedSnapshot) >= 0 ? normalizedSaved : normalizedSnapshot;
}

function normalizeCursor(candidate: Cursor | null): Cursor {
  if (!candidate) return ZERO_CURSOR;
  if (compareCursor(candidate, ZERO_CURSOR) < 0) return ZERO_CURSOR;
  return candidate;
}

export function nextMonotonicCursor(current: Cursor, candidate: Cursor): Cursor {
  return compareCursor(candidate, current) > 0 ? candidate : current;
}

export function shouldPersistBootstrapCursor(fromCursor: Cursor, finalCursor: Cursor, currentCursor: Cursor): boolean {
  if (compareCursor(finalCursor, fromCursor) <= 0) return false;
  if (compareCursor(finalCursor, currentCursor) < 0) return false;
  return true;
}

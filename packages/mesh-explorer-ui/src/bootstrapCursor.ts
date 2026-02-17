import type { Cursor } from "./graphStore.js";
import { compareCursor } from "./syncGuards.js";

export const ZERO_CURSOR: Cursor = { metaSeq: 0, graphSeq: 0 };

type StoreSnapshot = { nodesCount: number; linksCount: number };

export function resolveBootstrapFromCursor(saved: Cursor | null, snapshot: StoreSnapshot): Cursor {
  if (isStoreEmpty(snapshot)) return ZERO_CURSOR;
  if (!saved) return ZERO_CURSOR;
  if (compareCursor(saved, ZERO_CURSOR) < 0) return ZERO_CURSOR;
  return saved;
}

export function isStoreEmpty(snapshot: StoreSnapshot): boolean {
  return snapshot.nodesCount === 0 && snapshot.linksCount === 0;
}

export function nextMonotonicCursor(current: Cursor, candidate: Cursor): Cursor {
  return compareCursor(candidate, current) > 0 ? candidate : current;
}

export function shouldPersistBootstrapCursor(fromCursor: Cursor, finalCursor: Cursor, currentCursor: Cursor): boolean {
  if (compareCursor(finalCursor, fromCursor) <= 0) return false;
  if (compareCursor(finalCursor, currentCursor) < 0) return false;
  return true;
}

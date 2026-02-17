import type { Cursor } from "./graphStore.js";
import { compareCursor } from "./syncGuards.js";

export const ZERO_CURSOR: Cursor = { metaSeq: 0, graphSeq: 0 };

export function resolveBootstrapFromCursor(saved: Cursor | null): Cursor {
  return saved ?? ZERO_CURSOR;
}

export function nextMonotonicCursor(current: Cursor, candidate: Cursor): Cursor {
  return compareCursor(candidate, current) > 0 ? candidate : current;
}

export function shouldPersistBootstrapCursor(fromCursor: Cursor, finalCursor: Cursor, currentCursor: Cursor): boolean {
  if (compareCursor(finalCursor, fromCursor) <= 0) return false;
  if (compareCursor(finalCursor, currentCursor) < 0) return false;
  return true;
}

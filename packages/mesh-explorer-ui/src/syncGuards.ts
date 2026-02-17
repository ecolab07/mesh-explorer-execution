import type { Cursor } from "./graphStore.js";

export function compareCursor(left: Cursor, right: Cursor): number {
  if (left.metaSeq !== right.metaSeq) return left.metaSeq - right.metaSeq;
  return left.graphSeq - right.graphSeq;
}

export function isCursorStrictlyAdvanced(current: Cursor, candidate: Cursor): boolean {
  return compareCursor(candidate, current) > 0;
}

export function persistCursorSafely(storageKey: string, cursor: Cursor, write: (key: string, value: string) => void): boolean {
  try {
    write(storageKey, JSON.stringify(cursor));
    return true;
  } catch {
    return false;
  }
}

export function rotateAbortController(current: AbortController | null): AbortController {
  current?.abort();
  return new AbortController();
}

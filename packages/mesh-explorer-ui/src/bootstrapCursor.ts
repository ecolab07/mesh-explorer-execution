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

export function chooseInitialSyncCursor(input: {
  persistedCursor: Cursor | null;
  serverCursor: Cursor | null;
  minReadableCursor: Cursor | null;
  snapshotCursor: Cursor | null;
  projectionEmpty: boolean;
}): Cursor {
  const persisted = sanitizeCursor(input.persistedCursor);
  const snapshot = sanitizeCursor(input.snapshotCursor);
  const minReadable = sanitizeCursor(input.minReadableCursor);
  const server = sanitizeCursor(input.serverCursor);

  if (input.projectionEmpty) {
    if (snapshot) return snapshot;
    if (minReadable) return minReadable;
    return ZERO_CURSOR;
  }

  if (persisted) return persisted;

  const candidates = [server, minReadable, snapshot]
    .filter((cursor): cursor is Cursor => cursor !== null);
  if (candidates.length === 0) return ZERO_CURSOR;
  return candidates.reduce((max, cursor) => (compareCursor(cursor, max) > 0 ? cursor : max), candidates[0]!);
}

function sanitizeCursor(cursor: Cursor | null): Cursor | null {
  if (!cursor) return null;
  if (!Number.isFinite(cursor.metaSeq) || !Number.isFinite(cursor.graphSeq)) return null;
  if (compareCursor(cursor, ZERO_CURSOR) < 0) return null;
  return cursor;
}

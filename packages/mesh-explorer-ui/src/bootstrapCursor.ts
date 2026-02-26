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
  return chooseInitialSyncCursorWithDiagnostics(input).chosenCursor;
}

export function chooseInitialSyncCursorWithDiagnostics(input: {
  persistedCursor: Cursor | null;
  serverCursor: Cursor | null;
  minReadableCursor: Cursor | null;
  snapshotCursor: Cursor | null;
  projectionEmpty: boolean;
}): {
  chosenCursor: Cursor;
  floorCursor: Cursor;
  candidateDiagnostics: Array<{ source: "persistedCursor" | "snapshotCursor"; cursor: Cursor | null; accepted: boolean; reason: string }>;
} {
  const persisted = sanitizeCursor(input.persistedCursor);
  const snapshot = sanitizeCursor(input.snapshotCursor);
  const minReadable = sanitizeCursor(input.minReadableCursor);
  const floor = minReadable ?? ZERO_CURSOR;

  const candidateDiagnostics: Array<{ source: "persistedCursor" | "snapshotCursor"; cursor: Cursor | null; accepted: boolean; reason: string }> = [
    { source: "persistedCursor", cursor: persisted, accepted: false, reason: "missing_or_invalid" },
    { source: "snapshotCursor", cursor: snapshot, accepted: false, reason: "missing_or_invalid" }
  ];

  const validCandidates = candidateDiagnostics.flatMap((candidate) => {
    if (!candidate.cursor) return [];
    if (compareCursor(candidate.cursor, floor) < 0) {
      candidate.reason = "below_min_readable_floor";
      return [];
    }
    candidate.accepted = true;
    candidate.reason = "admissible";
    return [candidate.cursor];
  });

  if (validCandidates.length > 0) {
    return {
      chosenCursor: validCandidates.reduce((max, cursor) => (compareCursor(cursor, max) > 0 ? cursor : max), validCandidates[0]!),
      floorCursor: floor,
      candidateDiagnostics
    };
  }

  return {
    chosenCursor: floor,
    floorCursor: floor,
    candidateDiagnostics
  };
}

function sanitizeCursor(cursor: Cursor | null): Cursor | null {
  if (!cursor) return null;
  if (!Number.isFinite(cursor.metaSeq) || !Number.isFinite(cursor.graphSeq)) return null;
  if (compareCursor(cursor, ZERO_CURSOR) < 0) return null;
  return cursor;
}

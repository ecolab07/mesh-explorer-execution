import type { Cursor } from "./graphStore.js";
import { compareCursor } from "./syncGuards.js";

export const ZERO_CURSOR: Cursor = { metaSeq: 0, graphSeq: 0 };

type StoreSnapshot = { cursor?: Cursor | null };

export type BootstrapCursorDecisionInput = {
  savedCursor: Cursor | null;
  snapshot: StoreSnapshot;
  stateDigest?: string | null;
};

export type BootstrapCursorDecision = {
  bootstrapFrom: Cursor;
  usedSavedCursor: boolean;
  reason: "snapshot-only-no-state-digest" | "saved-vs-snapshot-with-state-digest";
  // TODO(Option-A): replace this boolean gate by a verified digest match check.
  optionAStateDigestMatched: boolean;
};

export function resolveBootstrapCursorDecision(input: BootstrapCursorDecisionInput): BootstrapCursorDecision {
  const normalizedSaved = normalizeCursor(input.savedCursor);
  const normalizedSnapshot = normalizeCursor(input.snapshot.cursor ?? null);
  const normalizedDigest = normalizeStateDigest(input.stateDigest);

  // Option B (current): poll is SoT; without durable local state proof, bootstrap from snapshot cursor.
  if (normalizedDigest === null) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-no-state-digest",
      optionAStateDigestMatched: false
    };
  }

  // Option A placeholder: once we can verify digest<->cursor consistency, this path can be tightened.
  const bootstrapFrom = compareCursor(normalizedSaved, normalizedSnapshot) >= 0 ? normalizedSaved : normalizedSnapshot;
  return {
    bootstrapFrom,
    usedSavedCursor: compareCursor(bootstrapFrom, normalizedSaved) === 0,
    reason: "saved-vs-snapshot-with-state-digest",
    optionAStateDigestMatched: true
  };
}

export function resolveBootstrapFromCursor(saved: Cursor | null, snapshot: StoreSnapshot): Cursor {
  return resolveBootstrapCursorDecision({ savedCursor: saved, snapshot, stateDigest: null }).bootstrapFrom;
}

function normalizeCursor(candidate: Cursor | null): Cursor {
  if (!candidate) return ZERO_CURSOR;
  if (compareCursor(candidate, ZERO_CURSOR) < 0) return ZERO_CURSOR;
  return candidate;
}

function normalizeStateDigest(stateDigest: string | null | undefined): string | null {
  if (!stateDigest) return null;
  const trimmed = stateDigest.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function nextMonotonicCursor(current: Cursor, candidate: Cursor): Cursor {
  return compareCursor(candidate, current) > 0 ? candidate : current;
}

export function shouldPersistBootstrapCursor(fromCursor: Cursor, finalCursor: Cursor, currentCursor: Cursor): boolean {
  if (compareCursor(finalCursor, fromCursor) <= 0) return false;
  if (compareCursor(finalCursor, currentCursor) < 0) return false;
  return true;
}

import type { Cursor } from "./graphStore.js";
import type { BootstrapCacheRecord } from "./bootstrapCache.js";
import { BOOTSTRAP_CACHE_SCHEMA_VERSION, BOOTSTRAP_SNAPSHOT_VERSION, computeStateDigest } from "./bootstrapCache.js";
import { compareCursor } from "./syncGuards.js";

export const ZERO_CURSOR: Cursor = { metaSeq: 0, graphSeq: 0 };

type StoreSnapshot = { cursor?: Cursor | null };

export type BootstrapCursorDecisionInput = {
  savedCursor: Cursor | null;
  snapshot: StoreSnapshot;
  bootstrapCache: BootstrapCacheRecord | null;
};

export type BootstrapCursorDecision = {
  bootstrapFrom: Cursor;
  usedSavedCursor: boolean;
  reason:
    | "snapshot-only-cache-missing"
    | "snapshot-only-snapshot-version-missing"
    | "snapshot-only-snapshot-version-mismatch"
    | "snapshot-only-schema-version-mismatch"
    | "snapshot-only-cursor-mismatch"
    | "snapshot-only-digest-mismatch"
    | "snapshot-cursor-cache-verified";
  invalidateBootstrapCache: boolean;
};

export function resolveBootstrapCursorDecision(input: BootstrapCursorDecisionInput): BootstrapCursorDecision {
  const normalizedSaved = normalizeCursor(input.savedCursor);
  const normalizedSnapshot = normalizeCursor(input.snapshot.cursor ?? null);

  if (!input.bootstrapCache) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-cache-missing",
      invalidateBootstrapCache: false
    };
  }

  if (input.bootstrapCache.schemaVersion !== BOOTSTRAP_CACHE_SCHEMA_VERSION) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-schema-version-mismatch",
      invalidateBootstrapCache: true
    };
  }

  if (typeof input.bootstrapCache.snapshotVersion !== "number") {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-snapshot-version-missing",
      invalidateBootstrapCache: true
    };
  }

  if (input.bootstrapCache.snapshotVersion !== BOOTSTRAP_SNAPSHOT_VERSION) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-snapshot-version-mismatch",
      invalidateBootstrapCache: true
    };
  }

  if (compareCursor(normalizeCursor(input.bootstrapCache.cursor), normalizedSnapshot) !== 0) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-cursor-mismatch",
      invalidateBootstrapCache: true
    };
  }

  const recomputedDigest = computeStateDigest(input.bootstrapCache.projection);
  if (recomputedDigest !== input.bootstrapCache.stateDigest) {
    return {
      bootstrapFrom: normalizedSnapshot,
      usedSavedCursor: false,
      reason: "snapshot-only-digest-mismatch",
      invalidateBootstrapCache: true
    };
  }

  return {
    bootstrapFrom: normalizedSnapshot,
    usedSavedCursor: true,
    reason: "snapshot-cursor-cache-verified",
    invalidateBootstrapCache: false
  };
}

export function resolveBootstrapFromCursor(saved: Cursor | null, snapshot: StoreSnapshot): Cursor {
  return resolveBootstrapCursorDecision({ savedCursor: saved, snapshot, bootstrapCache: null }).bootstrapFrom;
}

function normalizeCursor(candidate: Cursor | null): Cursor {
  if (!candidate) return ZERO_CURSOR;
  if (compareCursor(candidate, ZERO_CURSOR) < 0) return ZERO_CURSOR;
  return candidate;
}

export function nextMonotonicCursor(current: Cursor, candidate: Cursor): Cursor {
  return compareCursor(candidate, current) > 0 ? candidate : current;
}

export function shouldPersistBootstrapCursor(fromCursor: Cursor, finalCursor: Cursor, currentCursor: Cursor, replayComplete: boolean): boolean {
  if (!replayComplete) return false;
  if (compareCursor(finalCursor, fromCursor) <= 0) return false;
  if (compareCursor(finalCursor, currentCursor) < 0) return false;
  return true;
}

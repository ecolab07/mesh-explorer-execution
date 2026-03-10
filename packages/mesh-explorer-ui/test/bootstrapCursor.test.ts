import { describe, expect, it } from "vitest";

import { BOOTSTRAP_SNAPSHOT_VERSION, makeBootstrapCacheRecord } from "../src/bootstrapCache.js";
import { bootstrapCacheStorageKey, cursorStorageKey } from "../src/cursorStorage.js";
import {
  nextMonotonicCursor,
  resolveBootstrapCursorDecision,
  resolveBootstrapFromCursor,
  shouldPersistBootstrapCursor,
  ZERO_CURSOR
} from "../src/bootstrapCursor.js";

describe("mesh explorer bootstrap cursor", () => {
  it("uses {0,0} when neither snapshot nor local cursor exists", () => {
    expect(resolveBootstrapFromCursor(null, { cursor: null })).toEqual({ metaSeq: 0, graphSeq: 0 });
  });

  it("uses snapshot cursor when persisted cursor is absent", () => {
    expect(resolveBootstrapFromCursor(null, { cursor: { metaSeq: 2, graphSeq: 8 } })).toEqual({ metaSeq: 2, graphSeq: 8 });
  });

  it("CT-A1 cache+snapshot verified => bootstrapFrom snapshot cursor", () => {
    const projection = {
      version: 1 as const,
      nodes: [{ id: "n1", label: "node-1" }],
      links: []
    };
    const cache = makeBootstrapCacheRecord({ metaSeq: 0, graphSeq: 0 }, projection);
    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 0, graphSeq: 0 },
      snapshot: { cursor: { metaSeq: 0, graphSeq: 0 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 0, graphSeq: 0 });
    expect(decision.usedSavedCursor).toBe(true);
    expect(decision.reason).toBe("snapshot-cursor-cache-verified");
  });

  it("CT-A2 digest mismatch => snapshot fallback", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 4 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );
    cache.stateDigest = "corrupted";

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 1, graphSeq: 4 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-digest-mismatch");
    expect(decision.invalidateBootstrapCache).toBe(true);
  });

  it("CT-A2b cursor mismatch => invalidate + snapshot fallback", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-cursor-mismatch");
    expect(decision.invalidateBootstrapCache).toBe(true);
  });

  it("CT-A3 schemaVersion mismatch => invalidate + snapshot fallback", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );
    cache.schemaVersion += 1;

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.reason).toBe("snapshot-only-schema-version-mismatch");
    expect(decision.invalidateBootstrapCache).toBe(true);
  });

  it("rejects cache when snapshotVersion is missing", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );
    delete cache.snapshotVersion;

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-snapshot-version-missing");
    expect(decision.invalidateBootstrapCache).toBe(true);
  });

  it("rejects cache when snapshotVersion mismatches even if schemaVersion matches", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );
    cache.snapshotVersion = BOOTSTRAP_SNAPSHOT_VERSION + 1;

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-snapshot-version-mismatch");
    expect(decision.invalidateBootstrapCache).toBe(true);
  });

  it("accepts cache when snapshotVersion matches and other guards pass", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 2, graphSeq: 8 } },
      bootstrapCache: cache
    });

    expect(decision.usedSavedCursor).toBe(true);
    expect(decision.reason).toBe("snapshot-cursor-cache-verified");
    expect(decision.invalidateBootstrapCache).toBe(false);
  });

  it("writes exact storage key format mesh.cursor.<principal>.<graphSpaceId>", () => {
    expect(cursorStorageKey("local-dev", "mesh-explorer-graph-v1")).toBe("mesh.cursor.local-dev.mesh-explorer-graph-v1");
    expect(bootstrapCacheStorageKey("local-dev", "mesh-explorer-graph-v1")).toBe(
      "mesh.bootstrapCache.local-dev.mesh-explorer-graph-v1"
    );
  });

  it("keeps cursor monotonic during bootstrap replay", () => {
    expect(nextMonotonicCursor({ metaSeq: 0, graphSeq: 4 }, { metaSeq: 0, graphSeq: 2 })).toEqual({ metaSeq: 0, graphSeq: 4 });
    expect(nextMonotonicCursor({ metaSeq: 0, graphSeq: 4 }, { metaSeq: 0, graphSeq: 6 })).toEqual({ metaSeq: 0, graphSeq: 6 });
  });

  it("persists bootstrap cursor only when replay converged, advanced, and remains monotonic", () => {
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 }, false)).toBe(false);
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 }, true)).toBe(true);
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 }, true)).toBe(false);
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 6 }, true)).toBe(false);
  });

  it("normalizes negative cursors to zero cursor", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: -1, graphSeq: -5 }, { cursor: ZERO_CURSOR })).toEqual(ZERO_CURSOR);
  });
});

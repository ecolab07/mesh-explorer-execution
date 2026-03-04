import { describe, expect, it } from "vitest";

import { makeBootstrapCacheRecord } from "../src/bootstrapCache.js";
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

  it("CT-A1 savedCursor + valid digest => bootstrapFrom savedCursor", () => {
    const projection = {
      version: 1 as const,
      nodes: [{ id: "n1", label: "node-1" }],
      links: []
    };
    const cache = makeBootstrapCacheRecord({ metaSeq: 2, graphSeq: 8 }, projection);
    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 0, graphSeq: 0 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 2, graphSeq: 8 });
    expect(decision.usedSavedCursor).toBe(true);
    expect(decision.reason).toBe("saved-cursor-cache-verified");
  });

  it("CT-A2 digest mismatch => snapshot fallback", () => {
    const cache = makeBootstrapCacheRecord(
      { metaSeq: 2, graphSeq: 8 },
      { version: 1, nodes: [{ id: "n1", label: "node-1" }], links: [] }
    );
    cache.stateDigest = "corrupted";

    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 1, graphSeq: 4 } },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 1, graphSeq: 4 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-digest-mismatch");
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

  it("persists bootstrap cursor only when it advanced and remains monotonic", () => {
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 })).toBe(true);
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 5 })).toBe(false);
    expect(shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, { metaSeq: 0, graphSeq: 5 }, { metaSeq: 0, graphSeq: 6 })).toBe(false);
  });

  it("normalizes negative cursors to zero cursor", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: -1, graphSeq: -5 }, { cursor: ZERO_CURSOR })).toEqual(ZERO_CURSOR);
  });
});

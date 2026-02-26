import { describe, expect, it } from "vitest";

import { cursorStorageKey } from "../src/cursorStorage.js";
import {
  chooseInitialSyncCursor,
  chooseInitialSyncCursorWithDiagnostics,
  isStoreEmpty,
  nextMonotonicCursor,
  resolveBootstrapFromCursor,
  shouldPersistBootstrapCursor,
  ZERO_CURSOR
} from "../src/bootstrapCursor.js";

describe("mesh explorer bootstrap cursor", () => {
  it("uses {0,0} when no local cursor exists (fresh browser)", () => {
    expect(resolveBootstrapFromCursor(null, { nodesCount: 1, linksCount: 0 })).toEqual({ metaSeq: 0, graphSeq: 0 });
  });

  it("keeps replaying history from {0,0} across refresh when local cursor is still absent", () => {
    expect(resolveBootstrapFromCursor(null, { nodesCount: 0, linksCount: 0 })).toEqual(ZERO_CURSOR);
  });

  it("uses {0,0} when store is empty even when persisted cursor exists", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: 2, graphSeq: 8 }, { nodesCount: 0, linksCount: 0 })).toEqual(ZERO_CURSOR);
  });

  it("uses persisted cursor when store is not empty", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: 2, graphSeq: 8 }, { nodesCount: 1, linksCount: 0 })).toEqual({ metaSeq: 2, graphSeq: 8 });
  });

  it("detects when store snapshot is empty", () => {
    expect(isStoreEmpty({ nodesCount: 0, linksCount: 0 })).toBe(true);
    expect(isStoreEmpty({ nodesCount: 1, linksCount: 0 })).toBe(false);
  });

  it("writes exact storage key format mesh.cursor.<principal>.<graphSpaceId>", () => {
    expect(cursorStorageKey("local-dev", "mesh-explorer-graph-v1")).toBe("mesh.cursor.local-dev.mesh-explorer-graph-v1");
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

  it("prefers persisted cursor over stale server cursor for bootstrap", () => {
    expect(chooseInitialSyncCursor({
      persistedCursor: { metaSeq: 0, graphSeq: 100 },
      serverCursor: { metaSeq: 0, graphSeq: 76 },
      minReadableCursor: { metaSeq: 0, graphSeq: 100 },
      snapshotCursor: { metaSeq: 0, graphSeq: 100 },
      projectionEmpty: false
    })).toEqual({ metaSeq: 0, graphSeq: 100 });
  });

  it("falls back to floor when persisted/snapshot are missing", () => {
    expect(chooseInitialSyncCursor({
      persistedCursor: null,
      serverCursor: { metaSeq: 0, graphSeq: 76 },
      minReadableCursor: { metaSeq: 0, graphSeq: 12 },
      snapshotCursor: null,
      projectionEmpty: false
    })).toEqual({ metaSeq: 0, graphSeq: 12 });
  });

  it("bootstrap respects minReadable floor even when projectionEmpty=true and snapshotCursor < minReadable", () => {
    expect(chooseInitialSyncCursor({
      persistedCursor: { metaSeq: 0, graphSeq: 6 },
      serverCursor: { metaSeq: 0, graphSeq: 18 },
      minReadableCursor: { metaSeq: 0, graphSeq: 6 },
      snapshotCursor: { metaSeq: 0, graphSeq: 5 },
      projectionEmpty: true
    })).toEqual({ metaSeq: 0, graphSeq: 6 });
  });

  it("falls back to minReadable when projection is empty and all candidates are below floor", () => {
    expect(chooseInitialSyncCursor({
      persistedCursor: { metaSeq: 0, graphSeq: 5 },
      serverCursor: { metaSeq: 0, graphSeq: 18 },
      minReadableCursor: { metaSeq: 0, graphSeq: 6 },
      snapshotCursor: { metaSeq: 0, graphSeq: 4 },
      projectionEmpty: true
    })).toEqual({ metaSeq: 0, graphSeq: 6 });
  });

  it("no repeated 410 loop after recovery when persistedCursor is updated to minReadable", () => {
    const firstLoad = chooseInitialSyncCursor({
      persistedCursor: null,
      serverCursor: null,
      minReadableCursor: { metaSeq: 0, graphSeq: 6 },
      snapshotCursor: { metaSeq: 0, graphSeq: 5 },
      projectionEmpty: true
    });
    expect(firstLoad.graphSeq).toBeGreaterThanOrEqual(6);

    const refreshLoad = chooseInitialSyncCursor({
      persistedCursor: { metaSeq: 0, graphSeq: 6 },
      serverCursor: null,
      minReadableCursor: null,
      snapshotCursor: { metaSeq: 0, graphSeq: 5 },
      projectionEmpty: true
    });
    expect(refreshLoad.graphSeq).toBeGreaterThanOrEqual(6);
  });

  it("emits diagnostics including rejected candidates under minReadable floor", () => {
    const result = chooseInitialSyncCursorWithDiagnostics({
      persistedCursor: { metaSeq: 0, graphSeq: 5 },
      serverCursor: { metaSeq: 0, graphSeq: 9 },
      minReadableCursor: { metaSeq: 0, graphSeq: 6 },
      snapshotCursor: { metaSeq: 0, graphSeq: 4 },
      projectionEmpty: true
    });

    expect(result.floorCursor).toEqual({ metaSeq: 0, graphSeq: 6 });
    expect(result.chosenCursor).toEqual({ metaSeq: 0, graphSeq: 6 });
    expect(result.candidateDiagnostics).toEqual([
      { source: "persistedCursor", cursor: { metaSeq: 0, graphSeq: 5 }, accepted: false, reason: "below_min_readable_floor" },
      { source: "snapshotCursor", cursor: { metaSeq: 0, graphSeq: 4 }, accepted: false, reason: "below_min_readable_floor" }
    ]);
  });

});

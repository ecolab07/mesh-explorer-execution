import { describe, expect, it } from "vitest";

import { cursorStorageKey } from "../src/cursorStorage.js";
import {
  chooseInitialSyncCursor,
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
      snapshotCursor: { metaSeq: 0, graphSeq: 100 }
    })).toEqual({ metaSeq: 0, graphSeq: 100 });
  });

  it("uses server cursor only when persisted cursor is missing", () => {
    expect(chooseInitialSyncCursor({
      persistedCursor: null,
      serverCursor: { metaSeq: 0, graphSeq: 76 },
      minReadableCursor: null,
      snapshotCursor: null
    })).toEqual({ metaSeq: 0, graphSeq: 76 });
  });
});

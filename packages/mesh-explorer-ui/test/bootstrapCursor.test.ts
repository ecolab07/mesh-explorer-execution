import { describe, expect, it } from "vitest";

import { cursorStorageKey } from "../src/cursorStorage.js";
import { nextMonotonicCursor, resolveBootstrapFromCursor, shouldPersistBootstrapCursor, ZERO_CURSOR } from "../src/bootstrapCursor.js";

describe("mesh explorer bootstrap cursor", () => {
  it("uses {0,0} when neither snapshot nor local cursor exists", () => {
    expect(resolveBootstrapFromCursor(null, { cursor: null })).toEqual({ metaSeq: 0, graphSeq: 0 });
  });

  it("uses persisted cursor when snapshot cursor is behind", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: 2, graphSeq: 8 }, { cursor: { metaSeq: 1, graphSeq: 6 } })).toEqual({ metaSeq: 2, graphSeq: 8 });
  });

  it("uses snapshot cursor when persisted cursor is absent", () => {
    expect(resolveBootstrapFromCursor(null, { cursor: { metaSeq: 2, graphSeq: 8 } })).toEqual({ metaSeq: 2, graphSeq: 8 });
  });

  it("uses max(savedCursor, snapshotCursor) to guarantee durable resume monotonicity", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: 3, graphSeq: 10 }, { cursor: { metaSeq: 4, graphSeq: 9 } })).toEqual({ metaSeq: 4, graphSeq: 9 });
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

  it("normalizes negative cursors to zero cursor", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: -1, graphSeq: -5 }, { cursor: ZERO_CURSOR })).toEqual(ZERO_CURSOR);
  });
});

import { describe, expect, it } from "vitest";

import { cursorStorageKey } from "../src/cursorStorage.js";
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

  it("ignores saved cursor when no local state digest exists (Option B)", () => {
    expect(resolveBootstrapFromCursor({ metaSeq: 3, graphSeq: 10 }, { cursor: { metaSeq: 4, graphSeq: 9 } })).toEqual({ metaSeq: 4, graphSeq: 9 });
    expect(resolveBootstrapFromCursor({ metaSeq: 2, graphSeq: 8 }, { cursor: { metaSeq: 1, graphSeq: 6 } })).toEqual({ metaSeq: 1, graphSeq: 6 });
  });


  it("bootstrap decision picks snapshot=0 when saved cursor exists but no state digest", () => {
    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 2, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 0, graphSeq: 0 } },
      stateDigest: null
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 0, graphSeq: 0 });
    expect(decision.usedSavedCursor).toBe(false);
    expect(decision.reason).toBe("snapshot-only-no-state-digest");
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

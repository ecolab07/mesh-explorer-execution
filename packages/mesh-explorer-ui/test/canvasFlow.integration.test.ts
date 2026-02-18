import { describe, expect, it } from "vitest";

import { nextEdgeDraft, type Vec2 } from "../src/graphCanvas2d.js";

describe("canvas flow integration", () => {
  it("creates an edge through start -> end clicks", () => {
    const cursor: Vec2 = { x: 0, y: 0 };
    const start = nextEdgeDraft(null, "n1", cursor);
    const commit = nextEdgeDraft(start.edgeDraft ?? null, "n2", { x: 20, y: 20 });
    expect(commit.commit).toEqual({ source: "n1", target: "n2" });
    expect(commit.edgeDraft).toBeNull();
  });

  it("cancels edge draft with background click", () => {
    const start = nextEdgeDraft(null, "n1", { x: 0, y: 0 });
    const cancel = nextEdgeDraft(start.edgeDraft ?? null, null, { x: 100, y: 100 });
    expect(cancel.edgeDraft).toBeNull();
  });
});

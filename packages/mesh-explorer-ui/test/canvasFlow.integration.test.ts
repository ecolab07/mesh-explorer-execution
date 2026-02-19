import { describe, expect, it } from "vitest";

import { hitTestEdges, nextEdgeDraft, nextSelectedEdgeIds, type CameraState, type Vec2 } from "../src/graphCanvas2d.js";

describe("canvas flow integration", () => {
  it("click near edge at various zoom levels hits edge", () => {
    const links = [{ id: "edge-1", source: "n1", target: "n2" }];
    const nodePositions = new Map([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 200, y: 0 }]
    ]);

    const cameras: CameraState[] = [
      { x: 0, y: 0, zoom: 0.2, minZoom: 0.2, maxZoom: 4 },
      { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 },
      { x: 0, y: 0, zoom: 3.5, minZoom: 0.2, maxZoom: 4 }
    ];

    for (const camera of cameras) {
      const centerX = 100 * camera.zoom;
      expect(hitTestEdges(links, nodePositions, camera, { x: centerX, y: 7.9 })).toBe("edge-1");
      expect(hitTestEdges(links, nodePositions, camera, { x: centerX, y: 8.1 })).toBeNull();
    }
  });

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

  it("clears selected edge when node is clicked", () => {
    const selected = nextSelectedEdgeIds(new Set(), { nodeHit: null, edgeHit: "edge-1", shiftKey: false });
    expect(selected).toEqual(new Set(["edge-1"]));

    const afterNodeClick = nextSelectedEdgeIds(selected, { nodeHit: "n1", edgeHit: null, shiftKey: false });
    expect(afterNodeClick).toEqual(new Set());
  });

  it("supports SHIFT multi-edge toggles and clears on background", () => {
    const selectedA = nextSelectedEdgeIds(new Set(), { nodeHit: null, edgeHit: "edge-a", shiftKey: false });
    const selectedAB = nextSelectedEdgeIds(selectedA, { nodeHit: null, edgeHit: "edge-b", shiftKey: true });
    const selectedB = nextSelectedEdgeIds(selectedAB, { nodeHit: null, edgeHit: "edge-a", shiftKey: true });
    const cleared = nextSelectedEdgeIds(selectedB, { nodeHit: null, edgeHit: null, shiftKey: false });

    expect(selectedAB).toEqual(new Set(["edge-a", "edge-b"]));
    expect(selectedB).toEqual(new Set(["edge-b"]));
    expect(cleared).toEqual(new Set());
  });
});

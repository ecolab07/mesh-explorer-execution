import { describe, expect, it } from "vitest";

import { hitTestEdges, nextEdgeDraft, type CameraState, type Vec2 } from "../src/graphCanvas2d.js";

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
});

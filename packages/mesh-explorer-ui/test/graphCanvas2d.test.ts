import { describe, expect, it } from "vitest";

import { computeEdgeHitSlopWorld, computeGraphBounds, distancePointToSegment, fitCameraToBounds, hitTestEdge, hitTestEdges, hitTestNode, nextEdgeDraft, screenToWorld, worldToScreen, zoomAtPoint, type CameraState } from "../src/graphCanvas2d.js";

describe("graphCanvas2d transforms", () => {
  it("keeps world point stable under cursor while zooming", () => {
    const camera: CameraState = { x: -100, y: 40, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const screen = { x: 320, y: 180 };
    const worldBefore = screenToWorld(screen, camera);
    const next = zoomAtPoint(camera, screen, 2.2);
    const worldAfter = screenToWorld(screen, next);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it("round-trips world/screen conversion", () => {
    const camera: CameraState = { x: 25, y: -12, zoom: 1.7, minZoom: 0.2, maxZoom: 4 };
    const world = { x: 200, y: 70 };
    const screen = worldToScreen(world, camera);
    expect(screenToWorld(screen, camera)).toEqual(world);
  });
});

describe("graphCanvas2d hit-testing", () => {
  it("hits node strictly within rendered shape", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const hit = hitTestNode([{ id: "a", position: { x: 100, y: 100 } }], camera, { x: 121.9, y: 100 });
    expect(hit).toBe("a");
  });

  it("does not hit node outside rendered shape", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const hit = hitTestNode([{ id: "a", position: { x: 100, y: 100 } }], camera, { x: 122.1, y: 100 });
    expect(hit).toBeNull();
  });

  it("returns top-most node when overlapping", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const hit = hitTestNode([
      { id: "bottom", position: { x: 50, y: 50 } },
      { id: "top", position: { x: 50, y: 50 } }
    ], camera, { x: 50, y: 50 });
    expect(hit).toBe("top");
  });
});

describe("edge hit-test helpers", () => {
  it("computes shortest distance from point to segment", () => {
    const d1 = distancePointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d1).toBeCloseTo(3, 6);

    const d2 = distancePointToSegment({ x: -2, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d2).toBeCloseTo(Math.hypot(2, 4), 6);
  });

  it("hit-tests a segment with world slop", () => {
    const near = hitTestEdge({ x: 5, y: 0.8 }, { aWorld: { x: 0, y: 0 }, bWorld: { x: 10, y: 0 } }, 1);
    const far = hitTestEdge({ x: 5, y: 1.2 }, { aWorld: { x: 0, y: 0 }, bWorld: { x: 10, y: 0 } }, 1);
    expect(near).toBe(true);
    expect(far).toBe(false);
  });

  it("converts edge slop px to world units from zoom", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 2, minZoom: 0.2, maxZoom: 4 };
    expect(computeEdgeHitSlopWorld(camera)).toBe(4);
  });

  it("keeps edge hit-testing disabled by default", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const edgeId = hitTestEdges(
      [{ id: "e1", source: "a", target: "b" }],
      new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 10, y: 0 }]
      ]),
      camera,
      { x: 5, y: 0 }
    );
    expect(edgeId).toBeNull();
  });
});

describe("edge draft state machine", () => {
  it("transitions idle -> start -> commit", () => {
    const start = nextEdgeDraft(null, "n1", { x: 0, y: 0 });
    expect(start.edgeDraft?.startNodeId).toBe("n1");
    const commit = nextEdgeDraft(start.edgeDraft ?? null, "n2", { x: 10, y: 20 });
    expect(commit.edgeDraft).toBeNull();
    expect(commit.commit).toEqual({ source: "n1", target: "n2" });
  });

  it("cancels when clicking same start or background", () => {
    const start = nextEdgeDraft(null, "n1", { x: 0, y: 0 }).edgeDraft;
    expect(nextEdgeDraft(start ?? null, "n1", { x: 0, y: 0 }).edgeDraft).toBeNull();
    expect(nextEdgeDraft(start ?? null, null, { x: 0, y: 0 }).edgeDraft).toBeNull();
  });
});


describe("graph fit helpers", () => {
  it("computes graph bounds from node centers", () => {
    const bounds = computeGraphBounds([
      { position: { x: 20, y: 30 } },
      { position: { x: 120, y: 160 } }
    ]);
    expect(bounds).toEqual({ minX: -2, minY: 8, maxX: 142, maxY: 182 });
  });

  it("fits camera to bounds and keeps center in viewport", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const next = fitCameraToBounds({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 800, height: 400 }, camera, 0.1);
    expect(next.zoom).toBeCloseTo(3.6, 6);
    expect(next.x).toBeCloseTo(-11.111111, 5);
    expect(next.y).toBeCloseTo(-5.555555, 5);
  });
});

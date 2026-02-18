import { describe, expect, it } from "vitest";

import { computeGraphBounds, fitCameraToBounds, hitTestNode, nextEdgeDraft, screenToWorld, worldToScreen, zoomAtPoint, type CameraState } from "../src/graphCanvas2d.js";

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
  it("hits node with slop", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const hit = hitTestNode([{ id: "a", position: { x: 100, y: 100 } }], camera, { x: 126, y: 100 });
    expect(hit).toBe("a");
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

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForceLayout2D, GraphCanvas2D, computeEdgeHitSlopWorld, computeGraphBounds, computeMinZoomEffective, computeParallelLinkCurvatures, computeSeedRadius, distancePointToSegment, fitCameraToBounds, hitTestEdge, hitTestEdges, hitTestNode, nextEdgeDraft, nextSelectedEdgeIds, screenToWorld, seededNodePosition, worldToScreen, zoomAtPoint, type CameraState } from "../src/graphCanvas2d.js";
import { LAYOUT_LIMITS, deriveLayoutParams } from "../src/ui/layoutSettings.js";

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

  it("hits edges using constant screen-pixel slop", () => {
    const edge = [{ id: "e1", source: "a", target: "b" }];
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 100, y: 0 }]
    ]);

    const lowZoom: CameraState = { x: 0, y: 0, zoom: 0.25, minZoom: 0.2, maxZoom: 4 };
    expect(hitTestEdges(edge, positions, lowZoom, { x: 50 * lowZoom.zoom, y: 7.5 })).toBe("e1");
    expect(hitTestEdges(edge, positions, lowZoom, { x: 50 * lowZoom.zoom, y: 8.5 })).toBeNull();

    const highZoom: CameraState = { x: 0, y: 0, zoom: 3.5, minZoom: 0.2, maxZoom: 4 };
    expect(hitTestEdges(edge, positions, highZoom, { x: 50 * highZoom.zoom, y: 7.5 })).toBe("e1");
    expect(hitTestEdges(edge, positions, highZoom, { x: 50 * highZoom.zoom, y: 8.5 })).toBeNull();
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

describe("edge selection state machine", () => {
  it("clears selected edges when a node is clicked", () => {
    const selected = new Set(["edge-1"]);
    expect(nextSelectedEdgeIds(selected, { nodeHit: "n1", edgeHit: null, shiftKey: false, toggleKey: false })).toEqual(new Set());
  });

  it("supports shift toggle for multi-edge selection", () => {
    const selectedA = nextSelectedEdgeIds(new Set(), { nodeHit: null, edgeHit: "edge-a", shiftKey: false, toggleKey: false });
    expect(selectedA).toEqual(new Set(["edge-a"]));

    const selectedAB = nextSelectedEdgeIds(selectedA, { nodeHit: null, edgeHit: "edge-b", shiftKey: true, toggleKey: false });
    expect(selectedAB).toEqual(new Set(["edge-a", "edge-b"]));

    const selectedB = nextSelectedEdgeIds(selectedAB, { nodeHit: null, edgeHit: "edge-a", shiftKey: true, toggleKey: false });
    expect(selectedB).toEqual(new Set(["edge-b"]));
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
  it("lowers effective min zoom as node count increases", () => {
    expect(computeMinZoomEffective(0.2, 10)).toBeCloseTo(0.2, 6);
    expect(computeMinZoomEffective(0.2, 50)).toBeCloseTo(0.2, 6);
    expect(computeMinZoomEffective(0.2, 200)).toBeLessThan(0.2);
  });

  it("fit camera can use adaptive min zoom for dense graphs", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 };
    const next = fitCameraToBounds({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 }, { width: 800, height: 600 }, camera, 0.1, 200);
    expect(next.zoom).toBeLessThan(0.2);
  });

});



describe("layout seeding helpers", () => {
  it("scales seed radius with square root of node count", () => {
    expect(computeSeedRadius(1)).toBeCloseTo(40, 6);
    expect(computeSeedRadius(4)).toBeCloseTo(80, 6);
    expect(computeSeedRadius(100)).toBeCloseTo(400, 6);
  });

  it("keeps seeded position deterministic for same id and node count", () => {
    expect(seededNodePosition("node-a", 30)).toEqual(seededNodePosition("node-a", 30));
    expect(seededNodePosition("node-a", 30)).not.toEqual(seededNodePosition("node-a", 90));
  });
});



describe("layout warmup modes", () => {
  it("runs HARD warmup synchronously", () => {
    const hard = new ForceLayout2D({ warmupMode: "HARD" });
    const off = new ForceLayout2D({ warmupMode: "OFF" });
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const links = [{ source: "a", target: "b" }, { source: "b", target: "c" }];

    hard.syncGraph(nodes, links);
    off.syncGraph(nodes, links);

    expect(hard.getPositions()).not.toEqual(off.getPositions());
  });

  it("schedules SOFT warmup through RAF", () => {
    const queue: FrameRequestCallback[] = [];
    const layout = new ForceLayout2D({
      warmupMode: "SOFT",
      requestFrame: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      cancelFrame: () => undefined
    });

    layout.syncGraph([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
    expect(queue.length).toBeGreaterThan(0);

    let safety = 0;
    while (queue.length > 0 && safety < 20) {
      const cb = queue.shift()!;
      cb(16);
      safety += 1;
    }
    expect(safety).toBeGreaterThan(1);
  });

  it("does not run soft-warmup when OFF", () => {
    const queue: FrameRequestCallback[] = [];
    const layout = new ForceLayout2D({
      warmupMode: "OFF",
      requestFrame: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      cancelFrame: () => undefined
    });

    layout.syncGraph([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
    expect(queue).toHaveLength(1);
  });
});
describe("layout engine", () => {
  it("uses deterministic seeded initial positions", () => {
    expect(seededNodePosition("node-a", 20)).toEqual(seededNodePosition("node-a", 20));
    expect(seededNodePosition("node-a", 20)).not.toEqual(seededNodePosition("node-b", 20));
  });

  it("keeps initial layout deterministic for same topology", () => {
    const mk = () => {
      const layout = new ForceLayout2D();
      layout.syncGraph([{ id: "a" }, { id: "b" }, { id: "c" }], [{ source: "a", target: "b" }, { source: "b", target: "c" }]);
      return layout.getPositions();
    };
    expect(mk()).toEqual(mk());
  });


  it("applies deterministic warmup ticks for same topology", () => {
    const mk = () => {
      const layout = new ForceLayout2D();
      layout.syncGraph([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "d" }]);
      return layout.getPositions();
    };
    expect(mk()).toEqual(mk());
  });

  it("reheats and slightly moves neighbors after dragging one node", () => {
    const layout = new ForceLayout2D();
    layout.syncGraph([{ id: "a" }, { id: "b" }, { id: "c" }], [{ source: "a", target: "b" }, { source: "b", target: "c" }]);
    layout.tick(20);
    const before = layout.getPositions();

    layout.setPin("a", { x: 320, y: 60 });
    layout.tick(12);
    layout.clearPin("a");
    layout.reheat(0.35);
    layout.tick(16);

    const after = layout.getPositions();
    const b0 = before.get("b")!;
    const b1 = after.get("b")!;
    const delta = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    expect(delta).toBeGreaterThan(0.01);
  });
});

describe("move command removal", () => {
  it("does not keep drag move commit hooks in UI command flow", () => {
    const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const canvasSource = readFileSync(new URL("../src/graphCanvas2d.ts", import.meta.url), "utf8");
    expect(indexSource.includes("commitNodeMove")).toBe(false);
    expect(canvasSource.includes("onMoveCommit")).toBe(false);
  });
});



describe("simulation scheduling", () => {
  it("does not run a hybrid manual render loop that ticks layout from GraphCanvas2D", () => {
    const canvasSource = readFileSync(new URL("../src/graphCanvas2d.ts", import.meta.url), "utf8");
    expect(canvasSource.includes("this.layout.tick(1)")).toBe(false);
  });

  it("keeps pointermove free from simulation stop-side effects", () => {
    const canvasSource = readFileSync(new URL("../src/graphCanvas2d.ts", import.meta.url), "utf8");
    expect(canvasSource.includes("simulation.stop")).toBe(false);
    expect(canvasSource.includes("alpha(0)")).toBe(false);
    expect(canvasSource.includes("alphaTarget(0)")).toBe(false);
  });
});

describe("layout settings bounds", () => {
  it("clamps extreme slider values to safe engine bounds", () => {
    const params = deriveLayoutParams({
      preset: "Balanced",
      repulsion: -2000,
      edgeLength: 5000,
      reactivity: 4,
      collision: 0,
      warmupMode: "HARD",
      debugLogs: false,
      cinematicFitOnImport: true,
      cinematicFitRate: 8
    });

    expect(params.chargeStrength).toBe(Math.abs(LAYOUT_LIMITS.repulsion.min));
    expect(params.linkDistance).toBe(LAYOUT_LIMITS.edgeLength.max);
    expect(params.collisionRadius).toBe(LAYOUT_LIMITS.collision.min);
    expect(params.alphaTarget).toBeLessThanOrEqual(0.28);
    expect(params.velocityDecay).toBeGreaterThanOrEqual(0.12);
  });
});


describe("GraphCanvas2D topology guards and reheat", () => {
  const raf = (cb: FrameRequestCallback) => {
    cb(16);
    return 1;
  };

  function createCanvasHarness() {
    const events = new Map<string, EventListener>();
    const ctx = {
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      fillText: () => undefined,
      setLineDash: () => undefined
    } as unknown as CanvasRenderingContext2D;

    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 640, height: 480 }),
      addEventListener: (name: string, listener: EventListener) => events.set(name, listener),
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined
    } as unknown as HTMLCanvasElement;

    return {
      canvas,
      fire(name: string, event: unknown) {
        events.get(name)?.(event as Event);
      }
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pointermove does not sync or reheat on ui-only hover", () => {
    vi.stubGlobal("window", {
      devicePixelRatio: 1,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const syncSpy = vi.spyOn(ForceLayout2D.prototype, "syncGraph");
    const reheatSpy = vi.spyOn(ForceLayout2D.prototype, "reheat");
    const { canvas, fire } = createCanvasHarness();

    const renderer = new GraphCanvas2D(canvas, {
      nodes: [{ id: "n1", label: "N1" }],
      links: [],
      selectedNodeIds: new Set(), selectedLinkIds: new Set()
    }, {
      camera: { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 },
      hoveredNodeId: null,
      edgeDraft: null,
      dragSelectionRect: null
    }, {
      onSelectionReplace: () => undefined,
      onSelectionToggle: () => undefined,
      onSelectionClear: () => undefined,
      onEdgeDraftChange: () => undefined,
      onCreateEdge: () => undefined
    });

    syncSpy.mockClear();
    reheatSpy.mockClear();
    fire("pointermove", { offsetX: 30, offsetY: 20, movementX: 1, movementY: 1 });

    expect(syncSpy).toHaveBeenCalledTimes(0);
    expect(reheatSpy).toHaveBeenCalledTimes(0);
    renderer.destroy();
  });

  it("topology change triggers syncGraph while ui-only update does not", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const syncSpy = vi.spyOn(ForceLayout2D.prototype, "syncGraph");
    const { canvas } = createCanvasHarness();

    const ui = { camera: { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 }, hoveredNodeId: null, edgeDraft: null, dragSelectionRect: null };
    const renderer = new GraphCanvas2D(canvas, { nodes: [{ id: "n1", label: "N1" }], links: [], selectedNodeIds: new Set(), selectedLinkIds: new Set() }, ui, {
      onSelectionReplace: () => undefined,
      onSelectionToggle: () => undefined,
      onSelectionClear: () => undefined,
      onEdgeDraftChange: () => undefined,
      onCreateEdge: () => undefined
    });

    syncSpy.mockClear();
    renderer.update({ nodes: [{ id: "n1", label: "N1" }], links: [], selectedNodeIds: new Set(), selectedLinkIds: new Set() }, { ...ui, hoveredNodeId: "n1" });
    expect(syncSpy).toHaveBeenCalledTimes(0);

    renderer.update({
      nodes: [{ id: "n1", label: "N1" }, { id: "n2", label: "N2" }],
      links: [{ id: "l1", source: "n1", target: "n2", type: "related" }],
      selectedNodeIds: new Set(), selectedLinkIds: new Set()
    }, ui);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("reheatLayout reheats and restarts simulation", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const reheatSpy = vi.spyOn(ForceLayout2D.prototype, "reheat");
    const restartSpy = vi.spyOn(ForceLayout2D.prototype, "restart");
    const { canvas } = createCanvasHarness();

    const renderer = new GraphCanvas2D(canvas, { nodes: [{ id: "n1", label: "N1" }], links: [], selectedNodeIds: new Set(), selectedLinkIds: new Set() }, {
      camera: { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 4 },
      hoveredNodeId: null,
      edgeDraft: null,
      dragSelectionRect: null
    }, {
      onSelectionReplace: () => undefined,
      onSelectionToggle: () => undefined,
      onSelectionClear: () => undefined,
      onEdgeDraftChange: () => undefined,
      onCreateEdge: () => undefined
    });

    reheatSpy.mockClear();
    restartSpy.mockClear();
    renderer.reheatLayout();

    expect(reheatSpy).toHaveBeenCalledWith(0.9);
    expect(restartSpy).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });
});


describe("parallel link curvature", () => {
  it("assigns distinct curvature values for parallel links", () => {
    const curvatureById = computeParallelLinkCurvatures([
      { id: "l1", source: "a", target: "b", type: "related" },
      { id: "l2", source: "a", target: "b", type: "related" },
      { id: "l3", source: "a", target: "b", type: "related" }
    ]);

    const values = ["l1", "l2", "l3"].map((id) => curvatureById.get(id));
    expect(new Set(values).size).toBe(3);
    expect(values.some((value) => Math.abs(value ?? 0) > 0)).toBe(true);
  });
});

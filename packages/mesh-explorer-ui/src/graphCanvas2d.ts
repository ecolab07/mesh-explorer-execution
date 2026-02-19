import type { GraphLink, GraphNode } from "./graphStore.js";

export type Vec2 = { x: number; y: number };
export type CameraState = { x: number; y: number; zoom: number; minZoom: number; maxZoom: number };
export type EdgeDraft = { startNodeId: string; cursorWorldPos: Vec2 };

export type GraphCanvasReadModel = {
  nodes: Array<GraphNode & { position: Vec2 }>;
  links: GraphLink[];
  selectedNodeIds: Set<string>;
};

export type CanvasUiState = {
  camera: CameraState;
  hoveredNodeId: string | null;
  edgeDraft: EdgeDraft | null;
  overlayPositions: Map<string, Vec2>;
  dragSelectionRect: { start: Vec2; end: Vec2 } | null;
};

export type GraphCanvasCallbacks = {
  onSelectionReplace: (ids: string[]) => void;
  onSelectionToggle: (id: string) => void;
  onSelectionClear: () => void;
  onEdgeDraftChange: (edgeDraft: EdgeDraft | null) => void;
  onCreateEdge: (source: string, target: string) => void;
  onMoveCommit: (positions: Map<string, Vec2>) => Promise<boolean>;
  onCameraChange?: (camera: CameraState) => void;
  onFitRequest?: () => void;
};

const NODE_RADIUS = 22;
const NODE_HIT_SLOP_PX = 0;
const EDGE_HIT_SLOP_PX = 8;
export const ENABLE_EDGE_HIT_TEST = true;

export function worldToScreen(world: Vec2, camera: CameraState): Vec2 {
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

export function screenToWorld(screen: Vec2, camera: CameraState): Vec2 {
  return { x: screen.x / camera.zoom + camera.x, y: screen.y / camera.zoom + camera.y };
}

export function zoomAtPoint(camera: CameraState, pointer: Vec2, nextZoomRaw: number): CameraState {
  const nextZoom = clamp(nextZoomRaw, camera.minZoom, camera.maxZoom);
  const worldBefore = screenToWorld(pointer, camera);
  const next = { ...camera, zoom: nextZoom };
  const worldAfter = screenToWorld(pointer, next);
  return {
    ...next,
    x: next.x + (worldBefore.x - worldAfter.x),
    y: next.y + (worldBefore.y - worldAfter.y)
  };
}

export function hitTestNode(nodes: Array<{ id: string; position: Vec2 }>, camera: CameraState, screenPoint: Vec2): string | null {
  const worldPoint = screenToWorld(screenPoint, camera);
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    const dx = worldPoint.x - node.position.x;
    const dy = worldPoint.y - node.position.y;
    const radius = NODE_RADIUS + NODE_HIT_SLOP_PX / camera.zoom;
    if (dx * dx + dy * dy <= radius * radius) {
      return node.id;
    }
  }
  return null;
}

export function distancePointToSegment(worldPoint: Vec2, aWorld: Vec2, bWorld: Vec2): number {
  const ab = { x: bWorld.x - aWorld.x, y: bWorld.y - aWorld.y };
  const ap = { x: worldPoint.x - aWorld.x, y: worldPoint.y - aWorld.y };
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  if (abLenSq === 0) {
    return Math.hypot(ap.x, ap.y);
  }
  const t = clamp((ap.x * ab.x + ap.y * ab.y) / abLenSq, 0, 1);
  const closest = { x: aWorld.x + ab.x * t, y: aWorld.y + ab.y * t };
  return Math.hypot(worldPoint.x - closest.x, worldPoint.y - closest.y);
}

export function hitTestEdge(worldPoint: Vec2, edge: { aWorld: Vec2; bWorld: Vec2 }, edgeSlopWorld: number): boolean {
  return distancePointToSegment(worldPoint, edge.aWorld, edge.bWorld) <= edgeSlopWorld;
}

export function computeEdgeHitSlopWorld(camera: CameraState): number {
  return EDGE_HIT_SLOP_PX / camera.zoom;
}

export function hitTestEdges(
  links: Array<{ id: string; source: string; target: string }>,
  nodePositions: Map<string, Vec2>,
  camera: CameraState,
  screenPoint: Vec2
): string | null {
  if (!ENABLE_EDGE_HIT_TEST) return null;
  const worldPoint = screenToWorld(screenPoint, camera);
  const edgeSlopWorld = computeEdgeHitSlopWorld(camera);
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const link = links[index]!;
    const aWorld = nodePositions.get(link.source);
    const bWorld = nodePositions.get(link.target);
    if (!aWorld || !bWorld) continue;
    if (hitTestEdge(worldPoint, { aWorld, bWorld }, edgeSlopWorld)) {
      return link.id;
    }
  }
  return null;
}

export function computeGraphBounds(nodes: Array<{ position: Vec2 }>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x - NODE_RADIUS);
    minY = Math.min(minY, node.position.y - NODE_RADIUS);
    maxX = Math.max(maxX, node.position.x + NODE_RADIUS);
    maxY = Math.max(maxY, node.position.y + NODE_RADIUS);
  }
  return { minX, minY, maxX, maxY };
}

export function fitCameraToBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  camera: CameraState,
  paddingRatio = 0.1
): CameraState {
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const paddedScale = Math.max(0.01, 1 - paddingRatio);
  const targetZoom = clamp(Math.min(viewport.width / boundsWidth, viewport.height / boundsHeight) * paddedScale, camera.minZoom, camera.maxZoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    ...camera,
    zoom: targetZoom,
    x: centerX - viewport.width / (2 * targetZoom),
    y: centerY - viewport.height / (2 * targetZoom)
  };
}

export function nextEdgeDraft(current: EdgeDraft | null, clickedNodeId: string | null, cursorWorldPos: Vec2): { edgeDraft: EdgeDraft | null; commit?: { source: string; target: string } } {
  if (!clickedNodeId) return { edgeDraft: null };
  if (!current) return { edgeDraft: { startNodeId: clickedNodeId, cursorWorldPos } };
  if (current.startNodeId === clickedNodeId) return { edgeDraft: null };
  return { edgeDraft: null, commit: { source: current.startNodeId, target: clickedNodeId } };
}

export class GraphCanvas2D {
  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private pointer = { x: 0, y: 0 };
  private panning = false;
  private dragging: { pointerStart: Vec2; original: Map<string, Vec2> } | null = null;
  private hoveredEdgeId: string | null = null;
  private selectedEdgeId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readModel: GraphCanvasReadModel,
    private ui: CanvasUiState,
    private readonly callbacks: GraphCanvasCallbacks
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.bindEvents();
    this.resize();
    this.render();
  }

  update(readModel: GraphCanvasReadModel, ui: CanvasUiState): void {
    this.readModel = readModel;
    this.ui = ui;
    this.render();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  private bindEvents(): void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.pointer = { x: event.offsetX, y: event.offsetY };
      const hit = hitTestNode(this.readModel.nodes, this.ui.camera, this.pointer);
      if (event.button === 1 || event.ctrlKey || event.metaKey || event.altKey) {
        this.panning = true;
        this.callbacks.onCameraChange?.(this.ui.camera);
        this.canvas.setPointerCapture(event.pointerId);
        this.startLoop();
        return;
      }
      if (hit) {
        if (event.shiftKey) {
          this.callbacks.onSelectionToggle(hit);
        } else if (!this.readModel.selectedNodeIds.has(hit)) {
          this.callbacks.onSelectionReplace([hit]);
        }
        if (this.readModel.selectedNodeIds.has(hit) || !event.shiftKey) {
          const original = new Map<string, Vec2>();
          const selected = this.readModel.selectedNodeIds.has(hit) ? this.readModel.selectedNodeIds : new Set([hit]);
          for (const id of selected) {
            const node = this.readModel.nodes.find((item) => item.id === id);
            if (node) original.set(id, node.position);
          }
          this.dragging = { pointerStart: screenToWorld(this.pointer, this.ui.camera), original };
          this.startLoop();
        }
      } else {
        this.callbacks.onSelectionClear();
      }
      this.canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      this.pointer = { x: event.offsetX, y: event.offsetY };
      const pointerWorld = screenToWorld(this.pointer, this.ui.camera);
      this.callbacks.onEdgeDraftChange(this.ui.edgeDraft ? { ...this.ui.edgeDraft, cursorWorldPos: pointerWorld } : null);
      if (this.panning) {
        this.ui.camera = {
          ...this.ui.camera,
          x: this.ui.camera.x - event.movementX / this.ui.camera.zoom,
          y: this.ui.camera.y - event.movementY / this.ui.camera.zoom
        };
        this.callbacks.onCameraChange?.(this.ui.camera);
        this.startLoop();
        return;
      }
      if (!this.dragging) {
        this.ui.hoveredNodeId = hitTestNode(this.readModel.nodes, this.ui.camera, this.pointer);
        this.hoveredEdgeId = this.ui.hoveredNodeId
          ? null
          : hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, this.pointer);
        this.render();
        return;
      }
      const delta = {
        x: pointerWorld.x - this.dragging.pointerStart.x,
        y: pointerWorld.y - this.dragging.pointerStart.y
      };
      this.ui.overlayPositions.clear();
      for (const [id, start] of this.dragging.original) {
        this.ui.overlayPositions.set(id, { x: start.x + delta.x, y: start.y + delta.y });
      }
      this.startLoop();
    };

    const onPointerUp = async (event: PointerEvent) => {
      const wasDragging = Boolean(this.dragging);
      if (this.dragging) {
        const commitMap = new Map(this.ui.overlayPositions);
        this.dragging = null;
        this.running = false;
        if (commitMap.size > 0) {
          const accepted = await this.callbacks.onMoveCommit(commitMap);
          if (!accepted) this.ui.overlayPositions.clear();
        }
      }
      if (this.panning) {
        this.panning = false;
      }
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      const pointerWorld = screenToWorld({ x: event.offsetX, y: event.offsetY }, this.ui.camera);
      if (!wasDragging) {
        const hit = hitTestNode(this.readModel.nodes, this.ui.camera, { x: event.offsetX, y: event.offsetY });
        if (hit) {
          this.selectedEdgeId = null;
          const next = nextEdgeDraft(this.ui.edgeDraft, hit, pointerWorld);
          this.callbacks.onEdgeDraftChange(next.edgeDraft);
          if (next.commit) this.callbacks.onCreateEdge(next.commit.source, next.commit.target);
        } else {
          const edgeHit = hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, { x: event.offsetX, y: event.offsetY });
          if (edgeHit) {
            this.selectedEdgeId = edgeHit;
            this.callbacks.onEdgeDraftChange(null);
          } else if (this.readModel.selectedNodeIds.size === 0) {
            this.selectedEdgeId = null;
          }
        }
      }
      this.render();
    };

    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", (event) => {
      void onPointerUp(event);
    });
    this.canvas.addEventListener("pointercancel", (event) => {
      void onPointerUp(event);
    });
    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { passive: false });
    this.canvas.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const ratio = Math.exp(-event.deltaY * 0.0015);
      this.ui.camera = zoomAtPoint(this.ui.camera, { x: event.offsetX, y: event.offsetY }, this.ui.camera.zoom * ratio);
      this.callbacks.onCameraChange?.(this.ui.camera);
      this.startLoop();
    }, { passive: false });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.callbacks.onEdgeDraftChange(null);
      if (event.key.toLowerCase() === "f") this.callbacks.onFitRequest?.();
    });
    window.addEventListener("resize", () => this.resize());
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      this.render();
      if (this.running && (this.dragging || this.panning)) {
        this.raf = requestAnimationFrame(tick);
      } else {
        this.running = false;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private render(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#f8fafc";
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.setTransform(
      dpr * this.ui.camera.zoom,
      0,
      0,
      dpr * this.ui.camera.zoom,
      -this.ui.camera.x * dpr * this.ui.camera.zoom,
      -this.ui.camera.y * dpr * this.ui.camera.zoom
    );

    for (const link of this.readModel.links) {
      const source = this.nodePos(link.source);
      const target = this.nodePos(link.target);
      if (!source || !target) continue;
      const selected = this.selectedEdgeId === link.id;
      const hovered = !selected && this.hoveredEdgeId === link.id;
      this.ctx.strokeStyle = selected ? "#2563eb" : hovered ? "#0ea5e9" : "#94a3b8";
      this.ctx.lineWidth = 2 / this.ui.camera.zoom;
      this.ctx.beginPath();
      this.ctx.moveTo(source.x, source.y);
      this.ctx.lineTo(target.x, target.y);
      this.ctx.stroke();
    }

    for (const node of this.readModel.nodes) {
      const pos = this.nodePos(node.id) ?? node.position;
      const selected = this.readModel.selectedNodeIds.has(node.id);
      this.ctx.fillStyle = selected ? "#1d4ed8" : "#0f172a";
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
      if (this.ui.hoveredNodeId === node.id) {
        this.ctx.strokeStyle = "#38bdf8";
        this.ctx.lineWidth = 3 / this.ui.camera.zoom;
        this.ctx.stroke();
      }
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = `${12 / this.ui.camera.zoom}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.fillText(node.label.slice(0, 14), pos.x, pos.y + 4 / this.ui.camera.zoom);
    }

    if (this.ui.edgeDraft) {
      const start = this.nodePos(this.ui.edgeDraft.startNodeId);
      if (start) {
        this.ctx.setLineDash([6 / this.ui.camera.zoom, 6 / this.ui.camera.zoom]);
        this.ctx.strokeStyle = "#f59e0b";
        this.ctx.lineWidth = 2 / this.ui.camera.zoom;
        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(this.ui.edgeDraft.cursorWorldPos.x, this.ui.edgeDraft.cursorWorldPos.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    }
  }

  private nodePos(id: string): Vec2 | null {
    const overlay = this.ui.overlayPositions.get(id);
    if (overlay) return overlay;
    const node = this.readModel.nodes.find((item) => item.id === id);
    return node?.position ?? null;
  }

  private nodePositions(): Map<string, Vec2> {
    const output = new Map<string, Vec2>();
    for (const node of this.readModel.nodes) {
      output.set(node.id, this.nodePos(node.id) ?? node.position);
    }
    return output;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

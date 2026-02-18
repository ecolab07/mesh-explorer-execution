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
};

const NODE_RADIUS = 22;
const HIT_SLOP = 8;

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
    const radius = NODE_RADIUS + HIT_SLOP / camera.zoom;
    if (dx * dx + dy * dy <= radius * radius) {
      return node.id;
    }
  }
  return null;
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
      this.pointer = { x: event.offsetX, y: event.offsetY };
      const hit = hitTestNode(this.readModel.nodes, this.ui.camera, this.pointer);
      if (event.button === 1 || event.ctrlKey || event.metaKey || event.altKey) {
        this.panning = true;
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
        this.startLoop();
        return;
      }
      if (!this.dragging) {
        this.ui.hoveredNodeId = hitTestNode(this.readModel.nodes, this.ui.camera, this.pointer);
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
        this.ui.overlayPositions.clear();
        this.running = false;
        if (commitMap.size > 0) {
          await this.callbacks.onMoveCommit(commitMap);
        }
      }
      if (this.panning) {
        this.panning = false;
      }
      const pointerWorld = screenToWorld({ x: event.offsetX, y: event.offsetY }, this.ui.camera);
      if (!wasDragging) {
        const hit = hitTestNode(this.readModel.nodes, this.ui.camera, { x: event.offsetX, y: event.offsetY });
        const next = nextEdgeDraft(this.ui.edgeDraft, hit, pointerWorld);
        this.callbacks.onEdgeDraftChange(next.edgeDraft);
        if (next.commit) this.callbacks.onCreateEdge(next.commit.source, next.commit.target);
      }
      this.render();
    };

    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", (event) => {
      void onPointerUp(event);
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const ratio = Math.exp(-event.deltaY * 0.0015);
      this.ui.camera = zoomAtPoint(this.ui.camera, { x: event.offsetX, y: event.offsetY }, this.ui.camera.zoom * ratio);
      this.startLoop();
    }, { passive: false });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.callbacks.onEdgeDraftChange(null);
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
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#f8fafc";
    this.ctx.fillRect(0, 0, width, height);

    for (const link of this.readModel.links) {
      const source = this.nodePos(link.source);
      const target = this.nodePos(link.target);
      if (!source || !target) continue;
      const sourceScreen = worldToScreen(source, this.ui.camera);
      const targetScreen = worldToScreen(target, this.ui.camera);
      this.ctx.strokeStyle = "#94a3b8";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(sourceScreen.x, sourceScreen.y);
      this.ctx.lineTo(targetScreen.x, targetScreen.y);
      this.ctx.stroke();
    }

    for (const node of this.readModel.nodes) {
      const pos = this.nodePos(node.id) ?? node.position;
      const screen = worldToScreen(pos, this.ui.camera);
      const selected = this.readModel.selectedNodeIds.has(node.id);
      this.ctx.fillStyle = selected ? "#1d4ed8" : "#0f172a";
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, NODE_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
      if (this.ui.hoveredNodeId === node.id) {
        this.ctx.strokeStyle = "#38bdf8";
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
      }
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "12px sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText(node.label.slice(0, 14), screen.x, screen.y + 4);
    }

    if (this.ui.edgeDraft) {
      const start = this.nodePos(this.ui.edgeDraft.startNodeId);
      if (start) {
        const startScreen = worldToScreen(start, this.ui.camera);
        const endScreen = worldToScreen(this.ui.edgeDraft.cursorWorldPos, this.ui.camera);
        this.ctx.setLineDash([6, 6]);
        this.ctx.strokeStyle = "#f59e0b";
        this.ctx.beginPath();
        this.ctx.moveTo(startScreen.x, startScreen.y);
        this.ctx.lineTo(endScreen.x, endScreen.y);
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
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

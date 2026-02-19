import type { GraphLink, GraphNode } from "./graphStore.js";

export type Vec2 = { x: number; y: number };
export type CameraState = { x: number; y: number; zoom: number; minZoom: number; maxZoom: number };
export type EdgeDraft = { startNodeId: string; cursorWorldPos: Vec2 };

type LayoutNode = { id: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number };

type LayoutLink = { source: string; target: string };

export type GraphCanvasReadModel = {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedNodeIds: Set<string>;
};

export type CanvasUiState = {
  camera: CameraState;
  hoveredNodeId: string | null;
  edgeDraft: EdgeDraft | null;
  dragSelectionRect: { start: Vec2; end: Vec2 } | null;
};

export type GraphCanvasCallbacks = {
  onSelectionReplace: (ids: string[]) => void;
  onSelectionToggle: (id: string) => void;
  onSelectionClear: () => void;
  onEdgeDraftChange: (edgeDraft: EdgeDraft | null) => void;
  onCreateEdge: (source: string, target: string) => void;
  onCameraChange?: (camera: CameraState) => void;
  onFitRequest?: () => void;
};

const NODE_RADIUS = 22;
const NODE_HIT_SLOP_PX = 0;
const EDGE_HIT_SLOP_PX = 8;
const LAYOUT_LINK_DISTANCE = 130;
const LAYOUT_LINK_STRENGTH = 0.02;
const LAYOUT_CHARGE_STRENGTH = 3000;
const LAYOUT_CENTERING = 0.01;
const LAYOUT_DAMPING = 0.82;
const LAYOUT_MIN_ALPHA = 0.0005;
const LAYOUT_ALPHA_DECAY = 0.04;
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

export function nextSelectedEdgeIds(
  current: ReadonlySet<string>,
  params: { nodeHit: string | null; edgeHit: string | null; shiftKey: boolean }
): Set<string> {
  if (params.nodeHit) return new Set();
  if (params.edgeHit) {
    if (!params.shiftKey) return new Set([params.edgeHit]);
    const next = new Set(current);
    if (next.has(params.edgeHit)) next.delete(params.edgeHit);
    else next.add(params.edgeHit);
    return next;
  }
  return new Set();
}

export function seededNodePosition(nodeId: string): Vec2 {
  const seedA = fnv1a32(nodeId);
  const seedB = fnv1a32(`${nodeId}:y`);
  const radius = 120 + (seedA % 60);
  const angle = ((seedB % 3600) / 3600) * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

export class ForceLayout2D {
  private readonly nodeById = new Map<string, LayoutNode>();
  private links: LayoutLink[] = [];
  private alpha = 0;

  syncGraph(nodes: Array<{ id: string }>, links: LayoutLink[]): void {
    const nextIds = new Set(nodes.map((node) => node.id));
    for (const id of this.nodeById.keys()) {
      if (!nextIds.has(id)) this.nodeById.delete(id);
    }

    for (const node of nodes) {
      if (this.nodeById.has(node.id)) continue;
      const seeded = seededNodePosition(node.id);
      this.nodeById.set(node.id, { id: node.id, x: seeded.x, y: seeded.y, vx: 0, vy: 0 });
    }

    this.links = links.filter((link) => this.nodeById.has(link.source) && this.nodeById.has(link.target));
    this.reheat(0.45);
  }

  reheat(amount = 0.25): void {
    this.alpha = Math.max(this.alpha, amount);
  }

  setPin(nodeId: string, position: Vec2): void {
    const node = this.nodeById.get(nodeId);
    if (!node) return;
    node.fx = position.x;
    node.fy = position.y;
    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    this.reheat(0.35);
  }

  clearPin(nodeId: string): void {
    const node = this.nodeById.get(nodeId);
    if (!node) return;
    delete node.fx;
    delete node.fy;
  }

  tick(iterations = 1): void {
    for (let i = 0; i < iterations; i += 1) {
      if (this.alpha <= LAYOUT_MIN_ALPHA) continue;
      this.tickOnce();
      this.alpha *= 1 - LAYOUT_ALPHA_DECAY;
    }
  }

  hasEnergy(): boolean {
    return this.alpha > LAYOUT_MIN_ALPHA;
  }

  getPositions(): Map<string, Vec2> {
    const output = new Map<string, Vec2>();
    for (const [id, node] of this.nodeById) {
      output.set(id, { x: node.x, y: node.y });
    }
    return output;
  }

  private tickOnce(): void {
    const alpha = this.alpha;
    const nodes = Array.from(this.nodeById.values());

    for (const node of nodes) {
      if (node.fx !== undefined && node.fy !== undefined) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      }
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]!;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy + 0.01;
        const force = (LAYOUT_CHARGE_STRENGTH * alpha) / distSq;
        const fx = dx * force;
        const fy = dy * force;
        if (a.fx === undefined) {
          a.vx += fx;
          a.vy += fy;
        }
        if (b.fx === undefined) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }

    for (const link of this.links) {
      const source = this.nodeById.get(link.source);
      const target = this.nodeById.get(link.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const delta = (dist - LAYOUT_LINK_DISTANCE) * LAYOUT_LINK_STRENGTH * alpha;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      if (source.fx === undefined) {
        source.vx += fx;
        source.vy += fy;
      }
      if (target.fx === undefined) {
        target.vx -= fx;
        target.vy -= fy;
      }
    }

    for (const node of nodes) {
      if (node.fx !== undefined && node.fy !== undefined) continue;
      node.vx += (0 - node.x) * LAYOUT_CENTERING * alpha;
      node.vy += (0 - node.y) * LAYOUT_CENTERING * alpha;
      node.vx *= LAYOUT_DAMPING;
      node.vy *= LAYOUT_DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

export class GraphCanvas2D {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout = new ForceLayout2D();
  private raf = 0;
  private running = false;
  private pointer = { x: 0, y: 0 };
  private panning = false;
  private draggingNodeIds: string[] = [];
  private hoveredEdgeId: string | null = null;
  private selectedEdgeIds = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readModel: GraphCanvasReadModel,
    private ui: CanvasUiState,
    private readonly callbacks: GraphCanvasCallbacks
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.syncLayoutGraph();
    this.layout.tick(40);
    this.bindEvents();
    this.resize();
    this.render();
  }

  update(readModel: GraphCanvasReadModel, ui: CanvasUiState): void {
    this.readModel = readModel;
    this.ui = ui;
    this.syncLayoutGraph();
    this.startLoop();
    this.render();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  getNodePositions(): Map<string, Vec2> {
    return this.layout.getPositions();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  private syncLayoutGraph(): void {
    this.layout.syncGraph(this.readModel.nodes.map((node) => ({ id: node.id })), this.readModel.links.map((link) => ({ source: link.source, target: link.target })));
  }

  private bindEvents(): void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.pointer = { x: event.offsetX, y: event.offsetY };
      const hit = hitTestNode(this.positionedNodes(), this.ui.camera, this.pointer);
      if (event.button === 1 || event.ctrlKey || event.metaKey || event.altKey) {
        this.panning = true;
        this.callbacks.onCameraChange?.(this.ui.camera);
        this.canvas.setPointerCapture(event.pointerId);
        this.startLoop();
        return;
      }
      if (hit) {
        this.selectedEdgeIds.clear();
        if (event.shiftKey) {
          this.callbacks.onSelectionToggle(hit);
        } else if (!this.readModel.selectedNodeIds.has(hit)) {
          this.callbacks.onSelectionReplace([hit]);
        }

        if (this.readModel.selectedNodeIds.has(hit) || !event.shiftKey) {
          const selected = this.readModel.selectedNodeIds.has(hit) ? this.readModel.selectedNodeIds : new Set([hit]);
          this.draggingNodeIds = Array.from(selected);
          const pointerWorld = screenToWorld(this.pointer, this.ui.camera);
          for (const id of this.draggingNodeIds) {
            this.layout.setPin(id, pointerWorld);
          }
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
      if (this.draggingNodeIds.length === 0) {
        this.ui.hoveredNodeId = hitTestNode(this.positionedNodes(), this.ui.camera, this.pointer);
        this.hoveredEdgeId = this.ui.hoveredNodeId
          ? null
          : hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, this.pointer);
        this.render();
        return;
      }

      for (const id of this.draggingNodeIds) {
        this.layout.setPin(id, pointerWorld);
      }
      this.layout.reheat(0.3);
      this.startLoop();
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasDragging = this.draggingNodeIds.length > 0;
      if (wasDragging) {
        for (const id of this.draggingNodeIds) {
          this.layout.clearPin(id);
        }
        this.draggingNodeIds = [];
        this.layout.reheat(0.22);
      }
      if (this.panning) {
        this.panning = false;
      }
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      const pointerWorld = screenToWorld({ x: event.offsetX, y: event.offsetY }, this.ui.camera);
      if (!wasDragging) {
        const positionedNodes = this.positionedNodes();
        const hit = hitTestNode(positionedNodes, this.ui.camera, { x: event.offsetX, y: event.offsetY });
        const edgeHit = hit
          ? null
          : hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, { x: event.offsetX, y: event.offsetY });
        this.selectedEdgeIds = nextSelectedEdgeIds(this.selectedEdgeIds, { nodeHit: hit, edgeHit, shiftKey: event.shiftKey });
        if (hit) {
          const next = nextEdgeDraft(this.ui.edgeDraft, hit, pointerWorld);
          this.callbacks.onEdgeDraftChange(next.edgeDraft);
          if (next.commit) this.callbacks.onCreateEdge(next.commit.source, next.commit.target);
        } else if (edgeHit) {
          this.callbacks.onEdgeDraftChange(null);
        }
      }
      this.startLoop();
      this.render();
    };

    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerUp);
    this.canvas.addEventListener("pointercancel", onPointerUp);
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
      this.layout.tick(1);
      this.render();
      const shouldContinue = this.panning || this.draggingNodeIds.length > 0 || this.layout.hasEnergy();
      if (this.running && shouldContinue) {
        this.raf = requestAnimationFrame(tick);
        return;
      }
      this.running = false;
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

    const positions = this.nodePositions();
    for (const link of this.readModel.links) {
      const source = positions.get(link.source);
      const target = positions.get(link.target);
      if (!source || !target) continue;
      const selected = this.selectedEdgeIds.has(link.id);
      const hovered = !selected && this.hoveredEdgeId === link.id;
      this.ctx.strokeStyle = selected ? "#2563eb" : hovered ? "#0ea5e9" : "#94a3b8";
      this.ctx.lineWidth = 2 / this.ui.camera.zoom;
      this.ctx.beginPath();
      this.ctx.moveTo(source.x, source.y);
      this.ctx.lineTo(target.x, target.y);
      this.ctx.stroke();
    }

    for (const node of this.readModel.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
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
      const start = positions.get(this.ui.edgeDraft.startNodeId);
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

  private positionedNodes(): Array<{ id: string; position: Vec2 }> {
    const positions = this.layout.getPositions();
    return this.readModel.nodes
      .map((node) => {
        const position = positions.get(node.id);
        return position ? { id: node.id, position } : null;
      })
      .filter((entry): entry is { id: string; position: Vec2 } => entry !== null);
  }

  private nodePositions(): Map<string, Vec2> {
    return this.layout.getPositions();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

import type { GraphLink, GraphNode } from "./graphStore.js";
import type { WarmupMode } from "./ui/layoutSettings.js";

export type Vec2 = { x: number; y: number };
export type CameraState = { x: number; y: number; zoom: number; minZoom: number; maxZoom: number };
export type EdgeDraft = { startNodeId: string; cursorWorldPos: Vec2 };

type LayoutNode = { id: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number };

type LayoutLink = { source: string; target: string };

export type CanvasLink = { id: string; source: string; target: string; type?: string; curvature?: number };

export type GraphCanvasReadModel = {
  nodes: GraphNode[];
  links: CanvasLink[];
  selectedNodeIds: Set<string>;
  selectedLinkIds: Set<string>;
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
  onSelectedEdgeIdsChange?: (ids: string[]) => void;
  onRequestDelete?: (selection: { kind: "none" } | { kind: "node"; nodeId: string } | { kind: "link"; linkId: string }) => void;
  onRequestRename?: (nodeId: string) => void;
  onCameraChange?: (camera: CameraState) => void;
  onFitRequest?: () => void;
};

const NODE_RADIUS = 22;
const NODE_HIT_SLOP_PX = 0;
const EDGE_HIT_SLOP_PX = 8;
const LAYOUT_LINK_DISTANCE = 64;
const LAYOUT_LINK_STRENGTH = 0.18;
const LAYOUT_CHARGE_STRENGTH = 58;
const LAYOUT_COLLISION_RADIUS = NODE_RADIUS * 1.05;
const LAYOUT_CENTERING = 0.03;
const LAYOUT_DAMPING = 0.82;
const LAYOUT_MIN_ALPHA = 0.0005;
const LAYOUT_ALPHA_DECAY = 0.04;
const SEED_BASE = 40;
const SEED_JITTER_RATIO = 0.35;
const MIN_ZOOM_DENSITY_THRESHOLD = 50;
const MIN_ZOOM_DENSITY_FLOOR = 0.05;
const WARMUP_TICKS = 64;
const SOFT_WARMUP_TICKS_PER_FRAME = 6;
export const ENABLE_EDGE_HIT_TEST = true;

export type LayoutParams = {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
  collisionRadius: number;
  centering: number;
  alphaTarget: number;
  alphaDecay: number;
  velocityDecay: number;
  minAlpha: number;
};

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  chargeStrength: LAYOUT_CHARGE_STRENGTH,
  linkDistance: LAYOUT_LINK_DISTANCE,
  linkStrength: LAYOUT_LINK_STRENGTH,
  collisionRadius: LAYOUT_COLLISION_RADIUS,
  centering: LAYOUT_CENTERING,
  alphaTarget: 0,
  alphaDecay: LAYOUT_ALPHA_DECAY,
  velocityDecay: 1 - LAYOUT_DAMPING,
  minAlpha: LAYOUT_MIN_ALPHA
};

type ForceLayoutOptions = {
  layoutParams?: Partial<LayoutParams>;
  warmupMode?: WarmupMode;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
  onSoftWarmupFrame?: () => void;
  onTick?: () => void;
};

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
  links: Array<{ id: string; source: string; target: string; curvature?: number }>,
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
    if (Math.abs(link.curvature ?? 0) > 0.0001) {
      const curvedHit = hitTestCurvedEdge(worldPoint, aWorld, bWorld, link.curvature ?? 0, edgeSlopWorld);
      if (curvedHit) return link.id;
      continue;
    }
    if (hitTestEdge(worldPoint, { aWorld, bWorld }, edgeSlopWorld)) {
      return link.id;
    }
  }
  return null;
}

function hitTestCurvedEdge(worldPoint: Vec2, source: Vec2, target: Vec2, curvature: number, edgeSlopWorld: number): boolean {
  const control = getCurvedControlPoint(source, target, curvature);
  const segments = 12;
  let prev = source;
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    const point = quadraticBezierPoint(source, control, target, t);
    if (distancePointToSegment(worldPoint, prev, point) <= edgeSlopWorld) return true;
    prev = point;
  }
  return false;
}

function quadraticBezierPoint(a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const x = mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x;
  const y = mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y;
  return { x, y };
}

export function computeParallelLinkCurvatures(links: CanvasLink[], curvatureStep = 0.15): Map<string, number> {
  const grouped = new Map<string, CanvasLink[]>();
  for (const link of links) {
    const a = link.source < link.target ? link.source : link.target;
    const b = link.source < link.target ? link.target : link.source;
    const key = `${a}|${b}|${link.type ?? ""}`;
    const group = grouped.get(key);
    if (group) {
      group.push(link);
    } else {
      grouped.set(key, [link]);
    }
  }

  const output = new Map<string, number>();
  for (const group of grouped.values()) {
    const sorted = [...group].sort((left, right) => left.id.localeCompare(right.id));
    const center = (sorted.length - 1) / 2;
    for (let index = 0; index < sorted.length; index += 1) {
      const link = sorted[index]!;
      const base = (index - center) * curvatureStep;
      const directionSign = link.source.localeCompare(link.target) <= 0 ? 1 : -1;
      output.set(link.id, base * directionSign);
    }
  }
  return output;
}

function getCurvedControlPoint(source: Vec2, target: Vec2, curvature: number): Vec2 {
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  return {
    x: midX + nx * length * curvature,
    y: midY + ny * length * curvature
  };
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
  paddingRatio = 0.1,
  nodeCount = 1
): CameraState {
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const paddedScale = Math.max(0.01, 1 - paddingRatio);
  const minZoomEffective = computeMinZoomEffective(camera.minZoom, nodeCount);
  const targetZoom = clamp(Math.min(viewport.width / boundsWidth, viewport.height / boundsHeight) * paddedScale, minZoomEffective, camera.maxZoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    ...camera,
    zoom: targetZoom,
    x: centerX - viewport.width / (2 * targetZoom),
    y: centerY - viewport.height / (2 * targetZoom)
  };
}

export function computeMinZoomEffective(minZoomBase: number, nodeCount: number): number {
  if (nodeCount < MIN_ZOOM_DENSITY_THRESHOLD) return minZoomBase;
  const densityFactor = Math.sqrt(Math.max(1, nodeCount / MIN_ZOOM_DENSITY_THRESHOLD));
  return Math.max(MIN_ZOOM_DENSITY_FLOOR, minZoomBase / densityFactor);
}

export function nextEdgeDraft(current: EdgeDraft | null, clickedNodeId: string | null, cursorWorldPos: Vec2): { edgeDraft: EdgeDraft | null; commit?: { source: string; target: string } } {
  if (!clickedNodeId) return { edgeDraft: null };
  if (!current) return { edgeDraft: { startNodeId: clickedNodeId, cursorWorldPos } };
  if (current.startNodeId === clickedNodeId) return { edgeDraft: null };
  return { edgeDraft: null, commit: { source: current.startNodeId, target: clickedNodeId } };
}

export function nextSelectedEdgeIds(
  current: ReadonlySet<string>,
  params: { nodeHit: string | null; edgeHit: string | null; shiftKey: boolean; toggleKey: boolean }
): Set<string> {
  if (params.nodeHit) return params.toggleKey ? new Set(current) : new Set();
  if (params.edgeHit) {
    if (!params.shiftKey && !params.toggleKey) return new Set([params.edgeHit]);
    const next = new Set(current);
    if (next.has(params.edgeHit)) next.delete(params.edgeHit);
    else next.add(params.edgeHit);
    return next;
  }
  return new Set();
}

export function getPreferredSpawnWorldPos(params: {
  lastPointerClientPos: Vec2 | null;
  canvasRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
  camera: CameraState;
}): Vec2 {
  const { lastPointerClientPos, canvasRect, camera } = params;
  if (lastPointerClientPos) {
    const inCanvas = lastPointerClientPos.x >= canvasRect.left
      && lastPointerClientPos.x <= canvasRect.left + canvasRect.width
      && lastPointerClientPos.y >= canvasRect.top
      && lastPointerClientPos.y <= canvasRect.top + canvasRect.height;
    if (inCanvas) {
      return screenToWorld({ x: lastPointerClientPos.x - canvasRect.left, y: lastPointerClientPos.y - canvasRect.top }, camera);
    }
  }
  return screenToWorld({ x: canvasRect.width / 2, y: canvasRect.height / 2 }, camera);
}

export function computeSeedRadius(nodeCount: number): number {
  return SEED_BASE * Math.sqrt(Math.max(1, nodeCount));
}

export function seededNodePosition(nodeId: string, nodeCount = 1): Vec2 {
  const seedA = fnv1a32(nodeId);
  const seedB = fnv1a32(`${nodeId}:y`);
  const radiusBase = computeSeedRadius(nodeCount);
  const jitter = (seedA % 1000) / 1000;
  const radius = radiusBase * (1 - SEED_JITTER_RATIO + jitter * SEED_JITTER_RATIO);
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
  private params: LayoutParams;
  private warmupMode: WarmupMode;
  private softWarmupFrame = 0;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (frameId: number) => void;
  private readonly onSoftWarmupFrame?: () => void;
  private readonly onTick?: () => void;
  private simulationFrame = 0;

  constructor(options: ForceLayoutOptions = {}) {
    this.params = { ...DEFAULT_LAYOUT_PARAMS, ...options.layoutParams };
    this.warmupMode = options.warmupMode ?? "HARD";
    this.requestFrame = options.requestFrame ?? ((callback) => {
      if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    });
    this.cancelFrame = options.cancelFrame ?? ((frameId) => {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameId);
        return;
      }
      clearTimeout(frameId);
    });
    this.onSoftWarmupFrame = options.onSoftWarmupFrame;
    this.onTick = options.onTick;
  }

  setLayoutParams(next: Partial<LayoutParams>): void {
    this.params = { ...this.params, ...next };
  }

  setWarmupMode(mode: WarmupMode): void {
    this.warmupMode = mode;
  }

  syncGraph(nodes: Array<{ id: string }>, links: LayoutLink[]): void {
    this.cancelSoftWarmup();
    const nextIds = new Set(nodes.map((node) => node.id));
    for (const id of this.nodeById.keys()) {
      if (!nextIds.has(id)) this.nodeById.delete(id);
    }

    const nodeCount = nodes.length;
    for (const node of nodes) {
      if (this.nodeById.has(node.id)) continue;
      const seeded = seededNodePosition(node.id, nodeCount);
      this.nodeById.set(node.id, { id: node.id, x: seeded.x, y: seeded.y, vx: 0, vy: 0 });
    }

    this.links = links.filter((link) => this.nodeById.has(link.source) && this.nodeById.has(link.target));
    this.reheat(0.45);
    if (this.warmupMode === "HARD") {
      this.tick(WARMUP_TICKS);
    }
    if (this.warmupMode === "SOFT") {
      this.scheduleSoftWarmup(WARMUP_TICKS);
    }
    this.ensureSimulationLoop();
  }

  reheat(amount = 0.25): void {
    this.alpha = Math.max(this.alpha, amount);
    this.ensureSimulationLoop();
  }

  restart(): void {
    this.ensureSimulationLoop();
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

  seedNodePosition(nodeId: string, position: Vec2): void {
    const node = this.nodeById.get(nodeId);
    if (!node) return;
    delete node.fx;
    delete node.fy;
    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    this.reheat(0.35);
  }

  tick(iterations = 1): void {
    for (let i = 0; i < iterations; i += 1) {
      if (this.alpha <= this.params.minAlpha) continue;
      this.tickOnce();
      this.alpha += (this.params.alphaTarget - this.alpha) * 0.08;
      this.alpha *= 1 - this.params.alphaDecay;
    }
  }

  hasEnergy(): boolean {
    return this.alpha > this.params.minAlpha;
  }

  destroy(): void {
    this.cancelSoftWarmup();
    this.cancelSimulationLoop();
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
        const dist = Math.sqrt(distSq);
        const collisionOverlap = this.params.collisionRadius * 2 - dist;
        const force = (this.params.chargeStrength * alpha) / distSq;
        const collisionForce = collisionOverlap > 0 ? (collisionOverlap * 0.35 + 0.001) * alpha : 0;
        const fx = dx * force + (dx / dist) * collisionForce;
        const fy = dy * force + (dy / dist) * collisionForce;
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
      const delta = (dist - this.params.linkDistance) * this.params.linkStrength * alpha;
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
      node.vx += (0 - node.x) * this.params.centering * alpha;
      node.vy += (0 - node.y) * this.params.centering * alpha;
      node.vx *= 1 - this.params.velocityDecay;
      node.vy *= 1 - this.params.velocityDecay;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  private scheduleSoftWarmup(remainingTicks: number): void {
    if (remainingTicks <= 0) return;
    this.softWarmupFrame = this.requestFrame(() => {
      this.softWarmupFrame = 0;
      this.tick(Math.min(SOFT_WARMUP_TICKS_PER_FRAME, remainingTicks));
      this.onTick?.();
      this.onSoftWarmupFrame?.();
      this.scheduleSoftWarmup(remainingTicks - SOFT_WARMUP_TICKS_PER_FRAME);
    });
  }

  private cancelSoftWarmup(): void {
    if (!this.softWarmupFrame) return;
    this.cancelFrame(this.softWarmupFrame);
    this.softWarmupFrame = 0;
  }

  private ensureSimulationLoop(): void {
    if (this.simulationFrame) return;
    if (!this.hasEnergy()) return;
    this.simulationFrame = this.requestFrame(() => {
      this.simulationFrame = 0;
      this.tick(1);
      this.onTick?.();
      if (this.hasEnergy()) this.ensureSimulationLoop();
    });
  }

  private cancelSimulationLoop(): void {
    if (!this.simulationFrame) return;
    this.cancelFrame(this.simulationFrame);
    this.simulationFrame = 0;
  }
}

export type GraphCanvasDebugLog = (event: string, payload?: Record<string, unknown>, throttleMs?: number) => void;

export type GraphCanvasOptions = {
  layoutParams?: Partial<LayoutParams>;
  warmupMode?: WarmupMode;
  debugLogsEnabled?: boolean;
  debugLog?: GraphCanvasDebugLog;
};

const graphCanvasDevMetrics = {
  activeCanvasInstances: 0,
  activeResizeObservers: 0
};

export class GraphCanvas2D {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout: ForceLayout2D;
  private renderRaf = 0;
  private pointer = { x: 0, y: 0 };
  private pointerInsideCanvas = false;
  private lastPointerClientPos: Vec2 | null = null;
  private pendingDragNodeIds: string[] = [];
  private pointerDownScreenPos: Vec2 | null = null;
  private panning = false;
  private draggingNodeIds: string[] = [];
  private hoveredEdgeId: string | null = null;
  private edgeDraftCursorWorldPos: Vec2 | null = null;
  private topologySignature = "";
  private debugLogsEnabled = false;
  private readonly debugLog?: GraphCanvasDebugLog;
  private resizeObserver: ResizeObserver | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readModel: GraphCanvasReadModel,
    private ui: CanvasUiState,
    private readonly callbacks: GraphCanvasCallbacks,
    options: GraphCanvasOptions = {}
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.debugLogsEnabled = options.debugLogsEnabled ?? false;
    this.debugLog = options.debugLog;
    this.layout = new ForceLayout2D({
      layoutParams: options.layoutParams,
      warmupMode: options.warmupMode,
      onSoftWarmupFrame: () => this.requestRender(),
      onTick: () => this.requestRender()
    });
    graphCanvasDevMetrics.activeCanvasInstances += 1;
    (window as Window & { __meshCanvasStats?: () => unknown }).__meshCanvasStats = () => ({ ...graphCanvasDevMetrics });
    this.syncLayoutGraph("init");
    this.bindEvents();
    this.resize();
    this.render();
  }

  update(readModel: GraphCanvasReadModel, ui: CanvasUiState): void {
    this.readModel = readModel;
    this.ui = ui;
    if (!this.ui.edgeDraft) this.edgeDraftCursorWorldPos = null;
    const nextSignature = this.computeTopologySignature();
    if (nextSignature !== this.topologySignature) {
      this.syncLayoutGraph("topology-change");
    }
    this.requestRender();
  }

  destroy(): void {
    if (this.renderRaf) cancelAnimationFrame(this.renderRaf);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
      graphCanvasDevMetrics.activeResizeObservers = Math.max(0, graphCanvasDevMetrics.activeResizeObservers - 1);
    }
    for (const cleanup of this.cleanupFns) cleanup();
    this.cleanupFns.length = 0;
    this.layout.destroy();
    graphCanvasDevMetrics.activeCanvasInstances = Math.max(0, graphCanvasDevMetrics.activeCanvasInstances - 1);
  }

  getNodePositions(): Map<string, Vec2> {
    return this.layout.getPositions();
  }

  setLayoutParams(params: Partial<LayoutParams>): void {
    this.layout.setLayoutParams(params);
    this.syncLayoutGraph("layout-params-change");
    this.emitDebug("layout.reheat", { amount: 0.45, reason: "layout-params-change" });
    this.emitDebug("layout.restart", { reason: "layout-params-change" });
    this.requestRender();
  }

  setWarmupMode(mode: WarmupMode): void {
    this.layout.setWarmupMode(mode);
  }

  setDebugLogsEnabled(enabled: boolean): void {
    this.debugLogsEnabled = enabled;
  }

  seedNodePosition(nodeId: string, position: Vec2): void {
    this.layout.seedNodePosition(nodeId, position);
    this.requestRender();
  }

  getPreferredSpawnWorldPos(): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return getPreferredSpawnWorldPos({ lastPointerClientPos: this.lastPointerClientPos, canvasRect: rect, camera: this.ui.camera });
  }

  getLastPointerWorldPos(): Vec2 | null {
    if (!this.pointerInsideCanvas || !this.lastPointerClientPos) return null;
    const rect = this.canvas.getBoundingClientRect();
    return screenToWorld({ x: this.lastPointerClientPos.x - rect.left, y: this.lastPointerClientPos.y - rect.top }, this.ui.camera);
  }

  getViewCenterWorldPos(): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return screenToWorld({ x: rect.width / 2, y: rect.height / 2 }, this.ui.camera);
  }

  nudgeZoomOut(factor = 0.96): void {
    const rect = this.canvas.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    this.ui.camera = zoomAtPoint(this.ui.camera, center, this.ui.camera.zoom * factor);
    this.callbacks.onCameraChange?.(this.ui.camera);
    this.requestRender();
  }

  clearTransientUiState(): void {
    this.edgeDraftCursorWorldPos = null;
    this.pendingDragNodeIds = [];
    this.draggingNodeIds = [];
    this.pointerDownScreenPos = null;
    this.ui.hoveredNodeId = null;
    this.ui.edgeDraft = null;
    this.callbacks.onEdgeDraftChange(null);
    this.requestRender();
  }

  reheatLayout(): void {
    this.emitDebug("layout.reheat", { amount: 0.9, reason: "ui-reheat-button" });
    this.layout.reheat(0.9);
    this.emitDebug("layout.restart", { reason: "ui-reheat-button" });
    this.layout.restart();
    this.requestRender();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  private syncLayoutGraph(reason: string): void {
    this.topologySignature = this.computeTopologySignature();
    const nodeCount = this.readModel.nodes.length;
    const linkCount = this.readModel.links.length;
    this.emitDebug("layout.syncGraph", { reason, nodeCount, linkCount });
    this.layout.syncGraph(this.readModel.nodes.map((node) => ({ id: node.id })), this.readModel.links.map((link) => ({ source: link.source, target: link.target })));
  }

  private bindEvents(): void {
    const onPointerDown = (event: PointerEvent) => {
      this.emitDebug("ui.pointerdown", { button: event.button, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey });
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.pointer = { x: event.offsetX, y: event.offsetY };
      this.pointerInsideCanvas = true;
      this.lastPointerClientPos = { x: event.clientX, y: event.clientY };
      this.pointerDownScreenPos = { ...this.pointer };
      const hit = hitTestNode(this.positionedNodes(), this.ui.camera, this.pointer);
      const edgeHit = hit
        ? null
        : hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, this.pointer);
      if (event.button === 1 || event.altKey) {
        this.panning = true;
        this.callbacks.onCameraChange?.(this.ui.camera);
        this.canvas.setPointerCapture(event.pointerId);
        this.requestRender();
        return;
      }
      if (hit) {
        if (!event.ctrlKey && !event.metaKey) this.callbacks.onSelectedEdgeIdsChange?.([]);
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          this.callbacks.onSelectionToggle(hit);
        } else if (!this.readModel.selectedNodeIds.has(hit)) {
          this.callbacks.onSelectionReplace([hit]);
        }

        if (this.readModel.selectedNodeIds.has(hit) || !event.shiftKey) {
          const selected = this.readModel.selectedNodeIds.has(hit) ? this.readModel.selectedNodeIds : new Set([hit]);
          this.pendingDragNodeIds = Array.from(selected);
        }
      } else {
        this.pendingDragNodeIds = [];
        if (!edgeHit) this.callbacks.onSelectionClear();
      }
      this.canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      this.pointer = { x: event.offsetX, y: event.offsetY };
      this.pointerInsideCanvas = true;
      this.lastPointerClientPos = { x: event.clientX, y: event.clientY };
      const pointerWorld = screenToWorld(this.pointer, this.ui.camera);
      if (this.ui.edgeDraft) this.edgeDraftCursorWorldPos = pointerWorld;
      if (this.panning) {
        this.ui.camera = {
          ...this.ui.camera,
          x: this.ui.camera.x - event.movementX / this.ui.camera.zoom,
          y: this.ui.camera.y - event.movementY / this.ui.camera.zoom
        };
        this.callbacks.onCameraChange?.(this.ui.camera);
        this.requestRender();
        return;
      }
      const movement = this.pointerDownScreenPos
        ? Math.hypot(this.pointer.x - this.pointerDownScreenPos.x, this.pointer.y - this.pointerDownScreenPos.y)
        : 0;
      if (this.draggingNodeIds.length === 0 && this.pendingDragNodeIds.length > 0 && movement > 3) {
        this.draggingNodeIds = [...this.pendingDragNodeIds];
        for (const id of this.draggingNodeIds) this.layout.setPin(id, pointerWorld);
        this.emitDebug("ui.drag.start", { draggedCount: this.draggingNodeIds.length });
      }
      if (this.draggingNodeIds.length === 0) {
        this.ui.hoveredNodeId = hitTestNode(this.positionedNodes(), this.ui.camera, this.pointer);
        this.hoveredEdgeId = this.ui.hoveredNodeId
          ? null
          : hitTestEdges(this.readModel.links, this.nodePositions(), this.ui.camera, this.pointer);
        this.requestRender();
        return;
      }

      for (const id of this.draggingNodeIds) {
        this.layout.setPin(id, pointerWorld);
      }
      this.emitDebug("layout.reheat", { amount: 0.3, reason: "drag-move" });
      this.layout.reheat(0.3);
      this.emitDebug("layout.restart", { reason: "drag-move" });
      this.layout.restart();
      this.requestRender();
    };

    const onPointerUp = (event: PointerEvent) => {
      this.emitDebug("ui.pointerup", { button: event.button });
      const wasDragging = this.draggingNodeIds.length > 0;
      this.pendingDragNodeIds = [];
      this.pointerDownScreenPos = null;
      if (wasDragging) {
        for (const id of this.draggingNodeIds) {
          this.layout.clearPin(id);
        }
        this.draggingNodeIds = [];
        this.emitDebug("ui.drag.end", {});
        this.emitDebug("layout.reheat", { amount: 0.22, reason: "drag-end" });
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
        const nextSelected = nextSelectedEdgeIds(this.readModel.selectedLinkIds, {
          nodeHit: hit,
          edgeHit,
          shiftKey: event.shiftKey,
          toggleKey: event.ctrlKey || event.metaKey
        });
        if (edgeHit && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          this.callbacks.onSelectionReplace([]);
        }
        this.callbacks.onSelectedEdgeIdsChange?.(Array.from(nextSelected));
        if (hit) {
          const canDraft = event.ctrlKey || event.metaKey;
          if (canDraft) {
            const next = nextEdgeDraft(this.ui.edgeDraft, hit, pointerWorld);
            this.edgeDraftCursorWorldPos = next.edgeDraft ? pointerWorld : null;
            this.callbacks.onEdgeDraftChange(next.edgeDraft);
            if (next.commit) this.callbacks.onCreateEdge(next.commit.source, next.commit.target);
          } else if (this.ui.edgeDraft) {
            this.edgeDraftCursorWorldPos = null;
            this.callbacks.onEdgeDraftChange(null);
          }
        } else if (edgeHit) {
          this.edgeDraftCursorWorldPos = null;
          this.callbacks.onEdgeDraftChange(null);
        }
      }
      this.requestRender();
    };

    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.cleanupFns.push(() => this.canvas.removeEventListener("pointerdown", onPointerDown));
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.cleanupFns.push(() => this.canvas.removeEventListener("pointermove", onPointerMove));
    this.canvas.addEventListener("pointerup", onPointerUp);
    this.cleanupFns.push(() => this.canvas.removeEventListener("pointerup", onPointerUp));
    const onPointerLeave = () => {
      this.pointerInsideCanvas = false;
    };
    this.canvas.addEventListener("pointerleave", onPointerLeave);
    this.cleanupFns.push(() => this.canvas.removeEventListener("pointerleave", onPointerLeave));
    this.canvas.addEventListener("pointercancel", onPointerUp);
    this.cleanupFns.push(() => this.canvas.removeEventListener("pointercancel", onPointerUp));
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    this.canvas.addEventListener("mousedown", onMouseDown, { passive: false });
    this.cleanupFns.push(() => this.canvas.removeEventListener("mousedown", onMouseDown));
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    this.canvas.addEventListener("auxclick", onAuxClick, { passive: false });
    this.cleanupFns.push(() => this.canvas.removeEventListener("auxclick", onAuxClick));
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const ratio = Math.exp(-event.deltaY * 0.0015);
      this.ui.camera = zoomAtPoint(this.ui.camera, { x: event.offsetX, y: event.offsetY }, this.ui.camera.zoom * ratio);
      this.callbacks.onCameraChange?.(this.ui.camera);
      this.requestRender();
    };
    this.canvas.addEventListener("wheel", onWheel, { passive: false });
    this.cleanupFns.push(() => this.canvas.removeEventListener("wheel", onWheel));
    const onKeyDown = (event: KeyboardEvent) => {
      this.emitDebug("ui.keydown", { key: event.key });
      if (event.key === "Escape") {
        this.edgeDraftCursorWorldPos = null;
        this.callbacks.onEdgeDraftChange(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !isTextInputTarget(event.target)) {
        const selectedNodeId = this.readModel.selectedNodeIds.values().next().value as string | undefined;
        const selectedLinkId = this.readModel.selectedLinkIds.values().next().value as string | undefined;
        if (selectedNodeId) {
          this.callbacks.onRequestDelete?.({ kind: "node", nodeId: selectedNodeId });
          return;
        }
        if (selectedLinkId) {
          this.callbacks.onRequestDelete?.({ kind: "link", linkId: selectedLinkId });
          return;
        }
      }
      if (event.key.toLowerCase() === "r" && !isTextInputTarget(event.target)) {
        const selectedNodeId = this.readModel.selectedNodeIds.values().next().value as string | undefined;
        if (selectedNodeId) this.callbacks.onRequestRename?.(selectedNodeId);
      }
      if (event.key.toLowerCase() === "f") this.callbacks.onFitRequest?.();
    };
    window.addEventListener("keydown", onKeyDown);
    this.cleanupFns.push(() => window.removeEventListener("keydown", onKeyDown));
    const host = this.canvas.parentElement;
    if (host && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      graphCanvasDevMetrics.activeResizeObservers += 1;
    } else {
      const onResize = () => this.resize();
      window.addEventListener("resize", onResize);
      this.cleanupFns.push(() => window.removeEventListener("resize", onResize));
    }
  }

  private requestRender(): void {
    if (this.renderRaf) return;
    this.renderRaf = requestAnimationFrame(() => {
      this.renderRaf = 0;
      this.render();
    });
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
      const selected = this.readModel.selectedLinkIds.has(link.id);
      const hovered = !selected && this.hoveredEdgeId === link.id;
      this.ctx.strokeStyle = selected ? "#2563eb" : hovered ? "#0ea5e9" : "#94a3b8";
      this.ctx.lineWidth = 2 / this.ui.camera.zoom;
      this.ctx.beginPath();
      this.ctx.moveTo(source.x, source.y);
      if (Math.abs(link.curvature ?? 0) > 0.0001) {
        const control = getCurvedControlPoint(source, target, link.curvature ?? 0);
        this.ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
      } else {
        this.ctx.lineTo(target.x, target.y);
      }
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
      const draftCursor = this.edgeDraftCursorWorldPos ?? this.ui.edgeDraft.cursorWorldPos;
      if (start) {
        this.ctx.setLineDash([6 / this.ui.camera.zoom, 6 / this.ui.camera.zoom]);
        this.ctx.strokeStyle = "#f59e0b";
        this.ctx.lineWidth = 2 / this.ui.camera.zoom;
        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(draftCursor.x, draftCursor.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    }
  }

  private computeTopologySignature(): string {
    const nodeIds = this.readModel.nodes.map((node) => node.id).sort();
    const linkIds = this.readModel.links
      .map((link) => `${link.id}:${link.source}->${link.target}`)
      .sort();
    return `${nodeIds.join("|")}::${linkIds.join("|")}`;
  }

  private emitDebug(event: string, payload?: Record<string, unknown>, throttleMs?: number): void {
    if (!this.debugLogsEnabled) return;
    this.debugLog?.(event, payload, throttleMs);
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

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

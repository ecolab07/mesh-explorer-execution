import {
  createGraphStore,
  type ConnectionStatus,
  type GraphEvent,
  type GraphLink,
  type GraphNode,
  type GraphState,
  type GraphStore
} from "./graphStore.js";
import { compareCursor, persistCursorSafely, rotateAbortController } from "./syncGuards.js";
import { isStoreEmpty, nextMonotonicCursor, resolveBootstrapFromCursor, shouldPersistBootstrapCursor } from "./bootstrapCursor.js";
import { cursorStorageKey } from "./cursorStorage.js";
import { buildSyncPollUrl } from "./syncPollRequest.js";
import {
  SUBSCRIBE_ERROR_LOG_THROTTLE_MS,
  SUBSCRIBE_RETRY_DELAY_MS,
  isSyncDebugEnabled
} from "./syncConfig.js";
import {
  computeGraphBounds,
  fitCameraToBounds,
  GraphCanvas2D,
  type CameraState,
  type CanvasUiState
} from "./graphCanvas2d.js";
import { LayoutPanel } from "./ui/LayoutPanel.js";
import { deriveLayoutParams, loadLayoutUiState, saveLayoutUiState, type LayoutUiState } from "./ui/layoutSettings.js";

type Cursor = { metaSeq: number; graphSeq: number };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type SyncTxBundle = { principalCursor?: number; txBundle?: { graphEvents?: unknown[]; metaEvents?: unknown[] } };
type SyncFrame =
  | { kind: "heartbeat"; cursorVisible?: number }
  | { kind: "cursor"; cursorVisible?: number }
  | { kind: "txBundles"; txBundlesVisible?: SyncTxBundle[] }
  | { kind?: string; cursorVisible?: number; txBundlesVisible?: SyncTxBundle[]; txBundle?: { graphEvents?: unknown[] } };

type SyncPollPayload = {
  meta?: Array<{ payload?: unknown }>;
  graph?: Array<{ payload?: unknown }>;
  cursorAfter?: Cursor;
};

export function mountMeshExplorerUi(container: HTMLElement): void {
  const initialPrincipal = readInitialPrincipal();
  container.innerHTML = `
    <section style="display:grid;grid-template-columns:320px 1fr;gap:12px;height:100vh;font-family:sans-serif;">
      <aside style="padding:12px;border-right:1px solid #ddd;overflow:auto;">
        <h3>Mesh Explorer</h3>
        <label>baseUrl <input id="baseUrl" style="width:100%" value="http://127.0.0.1:8090"/></label><br/>
        <label>graphSpaceId <input id="graphSpaceId" style="width:100%" value="mesh-explorer-graph-v1"/></label><br/>
        <label>principal <input id="principal" style="width:100%" value="${escapeHtml(initialPrincipal)}"/></label><br/>
        <button id="connect">Connect</button>
        <hr/>
        <div id="status">Connectivity: Degraded</div>
        <div id="transport">transport: disconnected</div>
        <div id="lastCursor">cursor: n/a</div>
        <div id="lastSync">last sync: n/a</div>
        <hr/>
        <button id="addNode">Add node</button>
        <button id="fitGraph" style="margin-left:8px;">Fit</button>
        <div id="layoutPanelHost"></div>
        <div style="margin-top:8px;padding:8px;border:1px solid #ddd;border-radius:8px;">
          <div><strong>Create link</strong></div>
          <label>type <input id="linkType" style="width:100%" value="related"/></label>
          <div id="linkSelectionHint" style="margin-top:6px;font-size:12px;color:#555;">Click a node, then click another node to create a link. Escape cancels draft.</div>
        </div>
        <div id="devBanner" style="display:none;margin-top:8px;padding:6px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:12px;"></div>
      </aside>
      <main style="position:relative;display:grid;grid-template-rows:1fr;gap:8px;padding:8px;">
        <canvas id="graphCanvas" style="border:1px solid #ddd;width:100%;height:100%;touch-action:none;"></canvas>
        <div id="rendererBadge" style="position:absolute;top:16px;right:16px;padding:4px 8px;border-radius:999px;background:#111827;color:white;font-size:12px;opacity:0.85;"></div>
      </main>
    </section>
  `;

  const el = byId(container);
  const debugAuth = isDebugAuthEnabled();
  const debugEnabled = isDebugEnabled();
  const verboseSyncErrors = isSyncDebugEnabled();
  const store = createGraphStore();
  let syncSession = 0;
  let rendererMode: "canvas-2d" | "fallback-json" = "canvas-2d";
  let activeAbort: AbortController | null = null;
  let hasUserMovedCamera = false;
  let autoFitApplied = false;
  let cameraInfo: CameraState = { x: -280, y: -180, zoom: 1, minZoom: 0.08, maxZoom: 3.5 };
  let browserConnectivityHint: ConnectivityStatus = navigator.onLine ? "online" : "offline";
  let networkConnectivityHint: ConnectivityStatus = "degraded";
  let connectivityState: ConnectivityStatus = "degraded";
  let badgeStats = { nodes: 0, links: 0 };
  let badgeRaf = 0;

  const uiState: CanvasUiState = {
    camera: cameraInfo,
    hoveredNodeId: null,
    edgeDraft: null,
    dragSelectionRect: null
  };

  let canvasRenderer: GraphCanvas2D | null = null;
  let layoutUiState: LayoutUiState = loadLayoutUiState();


  setConnectionStatus("disconnected");
  installConnectivityListeners();
  updateConnectivity("init");
  setupRenderer();
  mountLayoutPanel();
  persistPrincipal(el.principal.value);
  el.principal.onchange = () => {
    const normalized = normalizePrincipal(el.principal.value);
    el.principal.value = normalized;
    persistPrincipal(normalized);
  };

  const unsubscribe = store.subscribe((snapshot: GraphState) => {
    const data: GraphData = {
      nodes: Array.from(snapshot.nodesById.values()),
      links: Array.from(snapshot.linksById.values()).filter((link: GraphLink) => snapshot.nodesById.has(link.source) && snapshot.nodesById.has(link.target))
    };
    canvasRenderer?.update({ nodes: data.nodes, links: data.links, selectedNodeIds: snapshot.selectedNodeIds }, uiState);
    if (!hasUserMovedCamera && !autoFitApplied && data.nodes.length > 0) {
      const applied = fitCameraToCurrentGraph();
      if (applied) autoFitApplied = true;
    }
    updateSelectionUi(snapshot);
    renderStatus(snapshot, data.nodes.length, data.links.length);
  });

  el.connect.onclick = () => {
    syncSession += 1;
    void connectAndSync(syncSession);
  };

  el.addNode.onclick = () => {
    const label = prompt("Node label", "new node") ?? "";
    if (!label) return;
    dbg("add-node:submit", { label });
    void addNode(label);
  };

  el.fitGraph.onclick = () => fitCameraToCurrentGraph();

  installTestHook(store);
  syncSession += 1;
  void connectAndSync(syncSession);

  async function connectAndSync(sessionId: number): Promise<void> {
    activeAbort = rotateAbortController(activeAbort);
    setConnectionStatus("connecting");
    const normalizedPrincipal = normalizePrincipal(el.principal.value);
    const storageKey = cursorStorageKey(normalizedPrincipal, el.graphSpaceId.value);
    const persistedCursor = readCursor(storageKey);
    const storeSnapshot = {
      nodesCount: store.getState().nodesById.size,
      linksCount: store.getState().linksById.size
    };
    const fromCursor = resolveBootstrapFromCursor(persistedCursor, storeSnapshot);
    dbg("sync:bootstrap:cursor-key", {
      principal: normalizedPrincipal,
      graphSpaceId: el.graphSpaceId.value,
      storageKey,
      isStoreEmpty: isStoreEmpty(storeSnapshot),
      persistedCursor,
      fromCursor
    });
    const replayResult = await pollReplayFromCursor(fromCursor, sessionId, activeAbort.signal);
    if (sessionId !== syncSession) return;
    persistBootstrapCursor(storageKey, fromCursor, replayResult.cursor);
    setConnectionStatus("connected (poll-only)");
    void subscribeLoop(sessionId, activeAbort.signal);

    async function subscribeLoop(activeSessionId: number, signal: AbortSignal): Promise<void> {
      let retryDelayMs = SUBSCRIBE_RETRY_DELAY_MS;
      let lastSubscribeErrorLogAt = 0;
      while (activeSessionId === syncSession) {
        try {
          const url = `${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:subscribe?from=${store.getState().cursor.graphSeq}`;
          const response = await meshFetch(url, { headers: headers(normalizedPrincipal), signal }, {
            principal: normalizedPrincipal,
            transport: "fetch-sse",
            debugAuth,
            onNetworkResult: (status) => markNetworkConnectivity(status, "sse-subscribe")
          });
          if (!response.body) {
            markNetworkConnectivity("degraded", "sse-empty-body");
            setConnectionStatus("reconnecting");
            await wait(retryDelayMs);
            continue;
          }
          markNetworkConnectivity("online", "sse-connected");
          setConnectionStatus("connected");
          retryDelayMs = SUBSCRIBE_RETRY_DELAY_MS;
          for await (const data of parseSse(response.body)) {
            if (activeSessionId !== syncSession) return;
            if (data.kind === "heartbeat") continue;
            if (data.kind === "txBundles") {
              const txBundles = data.txBundlesVisible ?? [];
              const cursorFromBundles = readCursorFromTxBundles(txBundles);
              if (cursorFromBundles !== null) {
                const next = { ...store.getState().cursor, graphSeq: cursorFromBundles };
                const advanced = applyCursorIfAdvanced(storageKey, next, "sse");
                if (advanced) {
                  store.applyGraphEvents(extractGraphEventsFromTxBundles(txBundles));
                  setLastSyncNow();
                }
                continue;
              }
              store.applyGraphEvents(extractGraphEventsFromTxBundles(txBundles));
              setLastSyncNow();
            }
          }
          if (activeSessionId === syncSession) {
            markNetworkConnectivity("degraded", "sse-ended");
            setConnectionStatus("reconnecting");
          }
        } catch (error) {
          if (signal.aborted) return;
          markNetworkConnectivity("offline", "sse-error");
          setConnectionStatus("reconnecting");
          const now = Date.now();
          const shouldLog = verboseSyncErrors || now - lastSubscribeErrorLogAt >= SUBSCRIBE_ERROR_LOG_THROTTLE_MS;
          if (shouldLog) {
            reportDevError(el, `sync subscribe failed: ${String(error)}`, error);
            lastSubscribeErrorLogAt = now;
          }
          await wait(retryDelayMs);
        }
      }
    }

    async function pollReplayFromCursor(initialCursor: Cursor, activeSessionId: number, signal: AbortSignal): Promise<{ cursor: Cursor; graphEventsApplied: number }> {
      let cursor = initialCursor;
      let graphEventsApplied = 0;
      try {
        while (activeSessionId === syncSession) {
          const response = await meshFetch(
            buildSyncPollUrl(el.baseUrl.value, el.graphSpaceId.value, cursor, { graph: 128, meta: 32 }),
            { headers: headers(normalizedPrincipal), signal },
            { principal: normalizedPrincipal, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "poll") }
          );
          if (!response.ok) {
            markNetworkConnectivity(response.status === 0 ? "offline" : "degraded", "poll-non-ok");
            reportDevError(el, `sync poll non-ok: ${response.status}`);
            return { cursor, graphEventsApplied };
          }
          const payload = (await response.json()) as SyncPollPayload;
          markNetworkConnectivity("online", "poll-success");
          const graphEvents = (payload.graph ?? []).map((entry) => asGraphEvent(entry.payload)).filter((event): event is GraphEvent => event !== null);
          const nextCursor = payload.cursorAfter ?? cursor;
          graphEventsApplied += graphEvents.length;
          store.applyGraphEvents(graphEvents);
          if (graphEvents.length > 0) setLastSyncNow();

          const nextMonotonic = nextMonotonicCursor(cursor, nextCursor);
          const cursorUnchanged = cursorEq(nextMonotonic, cursor);
          cursor = nextMonotonic;
          if ((payload.meta?.length ?? 0) === 0 && (payload.graph?.length ?? 0) === 0 || cursorUnchanged) break;
        }
        return { cursor, graphEventsApplied };
      } catch (error) {
        if (signal.aborted) return { cursor, graphEventsApplied };
        markNetworkConnectivity("offline", "poll-error");
        reportDevError(el, `sync poll failed: ${String(error)}`, error);
        return { cursor, graphEventsApplied };
      }
    }
  }

  async function addNode(label: string): Promise<void> {
    try {
      const response = await meshFetch(`${el.baseUrl.value}/graph/nodes`, {
        method: "POST",
        headers: headers(el.principal.value),
        body: JSON.stringify({ label, idempotencyKey: crypto.randomUUID() })
      }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "add-node") });
      if (!response.ok) reportDevError(el, `add node failed: ${response.status}`);
    } catch (error) {
      reportDevError(el, `add node failed: ${String(error)}`, error);
    }
  }

  async function createLinkFromDraft(source: string, target: string): Promise<void> {
    const type = el.linkType.value.trim() || "related";
    try {
      const response = await meshFetch(`${el.baseUrl.value}/graph/links`, {
        method: "POST",
        headers: headers(el.principal.value),
        body: JSON.stringify({ source, target, type, idempotencyKey: crypto.randomUUID() })
      }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "create-link") });
      if (!response.ok) reportDevError(el, `create link rejected: ${response.status}`);
    } catch (error) {
      reportDevError(el, `add link failed: ${String(error)}`, error);
    }
  }

  function setupRenderer(): void {
    try {
      canvasRenderer = new GraphCanvas2D(el.graphCanvas, { nodes: [], links: [], selectedNodeIds: new Set() }, uiState, {
        onSelectionReplace: (ids) => store.replaceSelection(ids),
        onSelectionToggle: (id) => store.toggleSelectNode(id),
        onSelectionClear: () => store.clearSelection(),
        onEdgeDraftChange: (edgeDraft) => {
          uiState.edgeDraft = edgeDraft;
          updateSelectionUi(store.getState());
          canvasRenderer?.update({
            nodes: Array.from(store.getState().nodesById.values()),
            links: Array.from(store.getState().linksById.values()),
            selectedNodeIds: store.getState().selectedNodeIds
          }, uiState);
        },
        onCreateEdge: (source, target) => {
          void createLinkFromDraft(source, target);
        },
        onCameraChange: (camera) => {
          hasUserMovedCamera = true;
          cameraInfo = camera;
          queueBadgeRender();
        },
        onFitRequest: () => {
          fitCameraToCurrentGraph();
        }
      }, {
        layoutParams: deriveLayoutParams(layoutUiState.settings),
        warmupMode: layoutUiState.settings.warmupMode
      });
      setRendererMode("canvas-2d");
    } catch (error) {
      setRendererMode("fallback-json");
      reportDevError(el, `renderer init failed: ${String(error)}`, error);
    }
  }

  function mountLayoutPanel(): void {
    const enabled = isLayoutPanelEnabled();
    new LayoutPanel(el.layoutPanelHost, {
      enabled,
      settings: layoutUiState.settings,
      panel: layoutUiState.panel
    }, {
      onSettingsChange: (next) => {
        layoutUiState = { ...layoutUiState, settings: next };
        saveLayoutUiState(layoutUiState);
        canvasRenderer?.setLayoutParams(deriveLayoutParams(next));
        canvasRenderer?.setWarmupMode(next.warmupMode);
      },
      onPanelStateChange: (panel) => {
        layoutUiState = { ...layoutUiState, panel };
        saveLayoutUiState(layoutUiState);
      },
      onReheat: () => canvasRenderer?.reheatLayout(),
      onFit: () => fitCameraToCurrentGraph()
    });
  }

  function fitCameraToCurrentGraph(): boolean {
    const positioned = Array.from((canvasRenderer?.getNodePositions() ?? new Map()).values()).map((position) => ({ position }));
    const bounds = computeGraphBounds(positioned);
    if (!bounds) return false;
    const rect = el.graphCanvas.getBoundingClientRect();
    uiState.camera = fitCameraToBounds(bounds, { width: rect.width, height: rect.height }, uiState.camera, 0.12, store.getState().nodesById.size);
    cameraInfo = uiState.camera;
    queueBadgeRender();
    canvasRenderer?.update({
      nodes: Array.from(store.getState().nodesById.values()),
      links: Array.from(store.getState().linksById.values()),
      selectedNodeIds: store.getState().selectedNodeIds
    }, uiState);
    return true;
  }

  function updateSelectionUi(snapshot: GraphState): void {
    const selected = Array.from(snapshot.selectedNodeIds);
    if (uiState.edgeDraft) {
      const from = snapshot.nodesById.get(uiState.edgeDraft.startNodeId)?.label ?? uiState.edgeDraft.startNodeId;
      el.linkSelectionHint.textContent = `Draft: ${from} → (click destination node, Escape to cancel)`;
      return;
    }
    if (selected.length === 0) {
      el.linkSelectionHint.textContent = "Click a node, then click another node to create a link. Shift+click toggles selection.";
      return;
    }
    el.linkSelectionHint.textContent = `Selected: ${selected.join(", ")}`;
  }

  function renderStatus(snapshot: GraphState, nodes: number, links: number): void {
    el.status.textContent = `Connectivity: ${formatConnectivity(connectivityState)}`;
    el.transport.textContent = `transport: ${snapshot.connectionStatus}`;
    el.lastCursor.textContent = `cursor: ${JSON.stringify(snapshot.cursor)}`;
    el.lastSync.textContent = `last sync: ${snapshot.lastSync}`;
    badgeStats = { nodes, links };
    queueBadgeRender();
    if (!el.principal.value.trim()) {
      el.transport.textContent = `transport: principal required, default "${DEFAULT_PRINCIPAL}" via x-mesh-principal`;
    }
  }

  function setConnectionStatus(next: ConnectionStatus): void {
    store.setConnectionStatus(next);
  }

  function markNetworkConnectivity(next: ConnectivityStatus, source: string): void {
    networkConnectivityHint = next;
    updateConnectivity(source);
  }

  function updateConnectivity(source: string): void {
    const next = resolveConnectivityState(browserConnectivityHint, networkConnectivityHint);
    if (next !== connectivityState) {
      connectivityState = next;
      renderStatus(store.getState(), store.getState().nodesById.size, store.getState().linksById.size);
    }
    dbg(`connectivity:${source}`, { browserConnectivityHint, networkConnectivityHint, connectivityState });
  }

  function installConnectivityListeners(): void {
    window.addEventListener("online", () => {
      browserConnectivityHint = "online";
      updateConnectivity("browser-online");
    });
    window.addEventListener("offline", () => {
      browserConnectivityHint = "offline";
      updateConnectivity("browser-offline");
    });
  }

  function setLastSyncNow(): void {
    store.setLastSync(new Date().toISOString());
  }

  function applyCursorIfAdvanced(storageKey: string, candidate: Cursor, source: "poll" | "sse"): boolean {
    const current = store.getState().cursor;
    if (compareCursor(candidate, current) <= 0) {
      emitMeshDebugLog("cursor-regression", { source, current, candidate });
      return false;
    }
    store.setCursor(candidate);
    persistCursor(storageKey, candidate);
    return true;
  }

  function persistBootstrapCursor(storageKey: string, fromCursor: Cursor, finalCursor: Cursor): void {
    const current = store.getState().cursor;
    if (!shouldPersistBootstrapCursor(fromCursor, finalCursor, current)) return;
    store.setCursor(finalCursor);
    persistCursor(storageKey, finalCursor);
  }

  function setRendererMode(mode: "canvas-2d" | "fallback-json"): void {
    rendererMode = mode;
    queueBadgeRender();
  }

  function queueBadgeRender(): void {
    if (badgeRaf) return;
    badgeRaf = requestAnimationFrame(() => {
      badgeRaf = 0;
      el.rendererBadge.textContent = `Renderer: ${rendererMode} | nodes=${badgeStats.nodes} links=${badgeStats.links} zoom=x${cameraInfo.zoom.toFixed(2)}`;
    });
  }

  function dbg(message: string, detail?: unknown): void {
    if (!debugEnabled) return;
    console.info("[mesh-debug]", message, detail);
  }

  container.addEventListener("DOMNodeRemoved", () => {
    unsubscribe();
    canvasRenderer?.destroy();
    syncSession += 1;
    activeAbort?.abort();
    setConnectionStatus("disconnected");
  });
}

type UiElements = {
  baseUrl: HTMLInputElement;
  graphSpaceId: HTMLInputElement;
  principal: HTMLInputElement;
  connect: HTMLButtonElement;
  addNode: HTMLButtonElement;
  fitGraph: HTMLButtonElement;
  linkType: HTMLInputElement;
  linkSelectionHint: HTMLDivElement;
  status: HTMLDivElement;
  transport: HTMLDivElement;
  lastCursor: HTMLDivElement;
  lastSync: HTMLDivElement;
  graphCanvas: HTMLCanvasElement;
  rendererBadge: HTMLDivElement;
  devBanner: HTMLDivElement;
  layoutPanelHost: HTMLDivElement;
};

function byId(container: HTMLElement): UiElements {
  return {
    baseUrl: container.querySelector("#baseUrl") as HTMLInputElement,
    graphSpaceId: container.querySelector("#graphSpaceId") as HTMLInputElement,
    principal: container.querySelector("#principal") as HTMLInputElement,
    connect: container.querySelector("#connect") as HTMLButtonElement,
    addNode: container.querySelector("#addNode") as HTMLButtonElement,
    fitGraph: container.querySelector("#fitGraph") as HTMLButtonElement,
    linkType: container.querySelector("#linkType") as HTMLInputElement,
    linkSelectionHint: container.querySelector("#linkSelectionHint") as HTMLDivElement,
    status: container.querySelector("#status") as HTMLDivElement,
    transport: container.querySelector("#transport") as HTMLDivElement,
    lastCursor: container.querySelector("#lastCursor") as HTMLDivElement,
    lastSync: container.querySelector("#lastSync") as HTMLDivElement,
    graphCanvas: container.querySelector("#graphCanvas") as HTMLCanvasElement,
    rendererBadge: container.querySelector("#rendererBadge") as HTMLDivElement,
    devBanner: container.querySelector("#devBanner") as HTMLDivElement,
    layoutPanelHost: container.querySelector("#layoutPanelHost") as HTMLDivElement
  };
}

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": normalizePrincipal(principal)
  };
}

type MeshFetchMeta = {
  principal: string;
  transport: "fetch" | "fetch-sse";
  debugAuth: boolean;
  onNetworkResult?: (status: ConnectivityStatus) => void;
};

type ConnectivityStatus = "online" | "degraded" | "offline";

async function meshFetch(input: string, init: RequestInit, meta: MeshFetchMeta): Promise<Response> {
  if (meta.debugAuth) {
    const resolvedUrl = resolveDebugUrl(input);
    const resolvedPrincipal = normalizePrincipal(meta.principal);
    console.info("[mesh-auth-debug] request", {
      transport: meta.transport,
      url: resolvedUrl,
      principal: resolvedPrincipal
    });
  }
  try {
    const response = await fetch(input, init);
    if (response.ok) {
      meta.onNetworkResult?.("online");
    } else if (response.status === 0) {
      meta.onNetworkResult?.("offline");
    } else {
      meta.onNetworkResult?.("degraded");
    }
    return response;
  } catch (error) {
    if (error instanceof TypeError) {
      meta.onNetworkResult?.("offline");
    } else {
      meta.onNetworkResult?.("degraded");
    }
    throw error;
  }
}

function isDebugAuthEnabled(): boolean {
  try {
    return localStorage.getItem("meshDebugAuth") === "1";
  } catch {
    return false;
  }
}

function isDebugEnabled(): boolean {
  const mode = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;
  if (mode) return true;
  try {
    return localStorage.getItem("mesh.debug") === "1";
  } catch {
    return false;
  }
}

function formatConnectivity(state: ConnectivityStatus): string {
  if (state === "online") return "Online";
  if (state === "offline") return "Offline";
  return "Degraded";
}

function isLayoutPanelEnabled(): boolean {
  const mode = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;
  if (mode) return true;
  try {
    return localStorage.getItem("mesh.layoutPanel") !== "0";
  } catch {
    return true;
  }
}

function resolveDebugUrl(input: string): string {
  try {
    return new URL(input, window.location.href).toString();
  } catch {
    return input;
  }
}

const DEFAULT_PRINCIPAL = "local-dev";
const PRINCIPAL_STORAGE_KEY = "mesh-explorer-principal";

function readInitialPrincipal(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("principal");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim();
    const fromStorage = localStorage.getItem(PRINCIPAL_STORAGE_KEY);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch {
    // ignore and use default
  }
  return DEFAULT_PRINCIPAL;
}

function persistPrincipal(principal: string): void {
  try {
    localStorage.setItem(PRINCIPAL_STORAGE_KEY, normalizePrincipal(principal));
  } catch {
    // ignore
  }
}

function normalizePrincipal(principal: string): string {
  const trimmed = principal.trim();
  return trimmed || DEFAULT_PRINCIPAL;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function readCursor(storageKey: string): Cursor | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cursor;
    if (typeof parsed.metaSeq !== "number" || typeof parsed.graphSeq !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistCursor(storageKey: string, cursor: Cursor): void {
  persistCursorSafely(storageKey, cursor, (key, value) => localStorage.setItem(key, value));
}

async function *parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SyncFrame> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx < 0) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!data) continue;
      yield JSON.parse(data) as SyncFrame;
    }
  }
}

function extractGraphEventsFromTxBundles(txBundles: SyncTxBundle[]): GraphEvent[] {
  const output: GraphEvent[] = [];
  for (const item of txBundles) {
    const graphEvents = item.txBundle?.graphEvents ?? [];
    for (const raw of graphEvents) {
      const event = asGraphEvent(raw);
      if (event) output.push(event);
    }
  }
  return output;
}

function asGraphEvent(value: unknown): GraphEvent | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as GraphEvent;
  if (typeof maybe.type !== "string") return null;
  return maybe;
}

function reportDevError(el: Pick<UiElements, "devBanner">, message: string, error?: unknown): void {
  console.error("[mesh-explorer]", message, error);
  if (!isDebugEnabled()) return;
  el.devBanner.style.display = "block";
  el.devBanner.textContent = message;
}

type MeshDebugApi = {
  selectNodes: (ids: string[]) => void;
  dump: () => { cursor: Cursor; nodesCount: number; linksCount: number };
  logs?: Array<{ message: string; detail?: unknown }>;
  log?: (message: string, detail?: unknown) => void;
};

function installTestHook(store: GraphStore): void {
  const mode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (mode !== "test" && !isDebugEnabled()) return;
  const meshDebug: MeshDebugApi = {
    selectNodes(ids: string[]) {
      store.replaceSelection(ids);
    },
    dump() {
      const state = store.getState();
      return {
        cursor: state.cursor,
        nodesCount: state.nodesById.size,
        linksCount: state.linksById.size
      };
    },
    logs: [],
    log(message, detail) {
      this.logs?.push({ message, detail });
    }
  };
  (window as Window & { __meshDebug?: MeshDebugApi }).__meshDebug = meshDebug;
}

function readCursorFromTxBundles(txBundles: SyncTxBundle[]): number | null {
  let maxCursor: number | null = null;
  for (const bundle of txBundles) {
    if (typeof bundle.principalCursor !== "number") continue;
    maxCursor = maxCursor === null ? bundle.principalCursor : Math.max(maxCursor, bundle.principalCursor);
  }
  return maxCursor;
}

function cursorEq(a: Cursor, b: Cursor): boolean {
  return a.metaSeq === b.metaSeq && a.graphSeq === b.graphSeq;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function emitMeshDebugLog(message: string, detail?: unknown): void {
  const dbgObj = (window as Window & { __meshDebug?: { log?: (message: string, detail?: unknown) => void } }).__meshDebug;
  dbgObj?.log?.(message, detail);
}

function resolveConnectivityState(browserHint: ConnectivityStatus, networkHint: ConnectivityStatus): ConnectivityStatus {
  if (networkHint === "offline" || browserHint === "offline") return "offline";
  if (networkHint === "degraded") return "degraded";
  return "online";
}

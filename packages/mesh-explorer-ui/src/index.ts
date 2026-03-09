import {
  createGraphStore,
  type ConnectionStatus,
  type GraphEvent,
  type GraphLink,
  type GraphNode,
  type GraphState,
  type GraphStore
} from "./graphStore.js";
import { compareCursor, rotateAbortController } from "./syncGuards.js";
import { applyGuardedSyncBatch, type IngestibleGraphEvent } from "./syncIngestion.js";
import { nextMonotonicCursor, resolveBootstrapCursorDecision, shouldPersistBootstrapCursor } from "./bootstrapCursor.js";
import { bootstrapCacheStorageKey, cursorStorageKey } from "./cursorStorage.js";
import { buildSyncPollUrl } from "./syncPollRequest.js";
import {
  SUBSCRIBE_ERROR_LOG_THROTTLE_MS,
  SUBSCRIBE_RETRY_DELAY_MS,
  isSyncDebugEnabled
} from "./syncConfig.js";
import {
  computeGraphBounds,
  computeParallelLinkCurvatures,
  fitCameraToBounds,
  type CameraState,
  type CanvasUiState
} from "./graphCanvas2d.js";
import { CanvasGraphViewport2D } from "./viewport/CanvasGraphViewport2D.js";
import type { GraphViewportActions, GraphViewportModel, Selection } from "./viewport/graphViewportContract.js";
import { UndoRedoManager } from "./undoRedo.js";
import { LayoutPanel } from "./ui/LayoutPanel.js";
import { deriveLayoutParams, loadLayoutUiState, saveLayoutUiState, type LayoutUiState } from "./ui/layoutSettings.js";
import { exportGraphFromState, parseExportedGraph, type ExportedGraphV1 } from "./devtools/graphIo.js";
import { buildMultiDeletePlan } from "./deleteSelection.js";
import { emitMeshDebugLogToSinks } from "./meshDebugLog.js";
import { evaluateSubscribeConvergence } from "./syncConvergenceGuard.js";
import {
  clearBootstrapCacheRecord,
  createProjectionSnapshot,
  hydrateStoreFromProjection,
  makeBootstrapCacheRecord,
  persistBootstrapCacheRecord,
  readBootstrapCacheRecord
} from "./bootstrapCache.js";

type Cursor = { metaSeq: number; graphSeq: number };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type SyncTxBundle = { principalCursor?: number; txBundle?: { txId?: string; graphEvents?: unknown[]; metaEvents?: unknown[] } };
type SyncFrame =
  | { kind: "heartbeat"; cursorVisible?: number }
  | { kind: "cursor"; cursorVisible?: number }
  | { kind: "txBundles"; txBundlesVisible?: SyncTxBundle[] }
  | { kind?: string; cursorVisible?: number; txBundlesVisible?: SyncTxBundle[]; txBundle?: { graphEvents?: unknown[] } };

type SyncPollPayload = {
  meta?: Array<{ payload?: unknown }>;
  graph?: Array<{ eventId?: string; payload?: unknown }>;
  cursorAfter?: Cursor;
};

export function mountMeshExplorerUi(container: HTMLElement): void {
  const initialPrincipal = readInitialPrincipal();
  const defaultBaseUrl = resolveMeshBaseUrl();
  const defaultSubscribeBaseUrl = resolveMeshSubscribeBaseUrl(defaultBaseUrl);
  container.innerHTML = `
    <section style="display:grid;grid-template-columns:320px 1fr;gap:12px;height:100vh;overflow:hidden;font-family:sans-serif;">
      <aside style="padding:12px;border-right:1px solid #ddd;overflow:auto;">
        <h3>Mesh Explorer</h3>
        <label>baseUrl <input id="baseUrl" style="width:100%" value="${escapeHtml(defaultBaseUrl)}"/></label><br/>
        <label>subscribeBaseUrl <input id="subscribeBaseUrl" style="width:100%" value="${escapeHtml(defaultSubscribeBaseUrl)}"/></label><br/>
        <label>graphSpaceId <input id="graphSpaceId" style="width:100%" value="mesh-explorer-graph-v1"/></label><br/>
        <label>principal <input id="principal" style="width:100%" value="${escapeHtml(initialPrincipal)}"/></label><br/>
        <button id="connect">Connect</button>
        <div style="margin-top:8px;padding:8px;border:1px solid #ddd;border-radius:8px;">
          <div><strong>Server policy (per project)</strong></div>
          <button id="projectsRefresh">Refresh projects</button>
          <button id="projectCreate" style="margin-left:8px;">Create project</button>
          <div id="projectsList" style="margin-top:6px;font-size:12px;max-height:100px;overflow:auto;"></div>
          <label>ttlSeconds <input id="policyTtl" style="width:100%" type="number" value="86400"/></label>
          <label>maxEvents <input id="policyMaxEvents" style="width:100%" type="number" value="20000"/></label>
          <label>snapshotEveryNEvents <input id="policyEveryN" style="width:100%" type="number" value="500"/></label>
          <label>snapshotEverySeconds <input id="policyEverySeconds" style="width:100%" type="number" value="300"/></label>
          <label>minSnapshotsToKeep <input id="policyMinSnapshots" style="width:100%" type="number" value="3"/></label>
          <button id="policySave">Save policy</button>
          <button id="snapshotCreate" style="margin-left:8px;">Create snapshot</button>
          <button id="snapshotList" style="margin-left:8px;">List snapshots</button>
          <button id="snapshotFork" style="margin-left:8px;">Fork latest</button>
          <button id="purgeNow" style="margin-left:8px;">Purge dry-run</button>
          <div id="projectReport" style="margin-top:6px;font-size:12px;color:#374151;"></div>
          <div style="margin-top:6px;font-size:12px;color:#6b7280;"><strong>App preferences (local only)</strong>: layout and debug options in the panel below.</div>
        </div>
        <hr/>
        <div id="status">Connectivity: Degraded</div>
        <div id="transport">transport: disconnected</div>
        <div id="lastCursor">cursor: n/a</div>
        <div id="lastSync">last sync: n/a</div>
        <hr/>
        <button id="addNode">Add node</button>
        <button id="renameSelected" style="margin-left:8px;">Rename</button>
        <button id="deleteSelected" style="margin-left:8px;">Delete</button>
        <button id="undoAction" style="margin-left:8px;">Undo</button>
        <button id="redoAction" style="margin-left:8px;">Redo</button>
        <button id="fitGraph" style="margin-left:8px;">Fit</button>
        <div id="layoutPanelHost"></div>
        <div style="margin-top:8px;padding:8px;border:1px solid #ddd;border-radius:8px;">
          <div><strong>Create link</strong></div>
          <label>type <input id="linkType" style="width:100%" value="related"/></label>
          <div id="linkSelectionHint" style="margin-top:6px;font-size:12px;color:#555;">Click a node, then click another node to create a link. Escape cancels draft.</div>
        </div>
        <div id="devBanner" style="display:none;margin-top:8px;padding:6px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:12px;"></div>
      </aside>
      <main style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:8px;padding:8px;">
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
  let autoFitRaf = 0;
  let isImporting = false;
  let importExpectedNodes = 0;
  let importExpectedLinks = 0;
  let importLastProgressiveFitAt = 0;
  let previousNodeCount = 0;
  let cameraInfo: CameraState = { x: -280, y: -180, zoom: 1, minZoom: 0.08, maxZoom: 3.5 };
  let browserConnectivityHint: ConnectivityStatus = navigator.onLine ? "online" : "offline";
  let networkConnectivityHint: ConnectivityStatus = "degraded";
  let connectivityState: ConnectivityStatus = "degraded";
  let badgeStats = { nodes: 0, links: 0 };
  let badgeRaf = 0;
  let lastTopologySignature = "";
  let lastCurvatureByLinkId = new Map<string, number>();
  let activeSyncSubscriptions = 0;
  let bootstrapReplayPending = false;
  const syncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map<string, Set<string>>() };

  const uiState: CanvasUiState = {
    camera: cameraInfo,
    hoveredNodeId: null,
    edgeDraft: null,
    dragSelectionRect: null
  };

  let canvasRenderer: CanvasGraphViewport2D | null = null;
  let previousNodeIds = new Set<string>();
  const pendingSpawnSeeds: Array<{ x: number; y: number }> = [];
  const undoRedo = new UndoRedoManager();
  let layoutUiState: LayoutUiState = loadLayoutUiState();
  const debugThrottleByEvent = new Map<string, number>();

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
    const topologySignature = `${Array.from(snapshot.nodesById.keys()).sort().join("|")}::${data.links.map((link) => `${link.id}:${link.source}:${link.target}:${link.type ?? ""}`).sort().join("|")}`;
    if (topologySignature !== lastTopologySignature) {
      lastCurvatureByLinkId = computeParallelLinkCurvatures(data.links);
      lastTopologySignature = topologySignature;
    }
    const curvatureByLinkId = lastCurvatureByLinkId;
    const viewLinks = data.links.map((link) => ({ ...link, curvature: curvatureByLinkId.get(link.id) ?? 0 }));
    applyPendingSpawnSeeds(snapshot.nodesById);
    canvasRenderer?.update({ nodes: data.nodes, links: viewLinks, selectedNodeIds: snapshot.selectedNodeIds, selectedLinkIds: snapshot.selectedLinkIds }, uiState);
    const transitionedToNonEmpty = previousNodeCount === 0 && data.nodes.length > 0;
    maybeRunImportProgressiveFit(data);
    if (!isImporting && !hasUserMovedCamera && !autoFitApplied && (transitionedToNonEmpty || data.nodes.length > 0)) {
      scheduleAutoFit();
    }
    previousNodeCount = data.nodes.length;
    updateSelectionUi(snapshot);
    renderStatus(snapshot, data.nodes.length, data.links.length);
  });

  el.connect.onclick = () => {
    syncSession += 1;
    void connectAndSync(syncSession);
  };
  el.projectsRefresh.onclick = () => {
    void refreshProjects();
  };
  el.projectCreate.onclick = () => {
    void createProject();
  };
  el.policySave.onclick = () => {
    void savePolicy();
  };
  el.snapshotCreate.onclick = () => {
    void createSnapshot();
  };
  el.snapshotList.onclick = () => {
    void listSnapshots();
  };
  el.snapshotFork.onclick = () => {
    void forkLatestSnapshot();
  };
  el.purgeNow.onclick = () => {
    void purgeHistoryDryRun();
  };

  el.addNode.onclick = () => {
    void promptAndCreateNode();
  };

  el.fitGraph.onclick = () => fitCameraToCurrentGraph();
  el.deleteSelected.onclick = () => {
    void requestDelete();
  };
  el.renameSelected.onclick = () => {
    const selection = currentSelection();
    if (selection.kind !== "node") return;
    void requestRename(selection.nodeId);
  };
  el.undoAction.onclick = () => {
    void undoRedo.undo().catch((error) => reportDevError(el, `undo failed: ${String(error)}`, error));
  };
  el.redoAction.onclick = () => {
    void undoRedo.redo().catch((error) => reportDevError(el, `redo failed: ${String(error)}`, error));
  };
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      void undoRedo.undo().catch((error) => reportDevError(el, `undo failed: ${String(error)}`, error));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
      event.preventDefault();
      void undoRedo.redo().catch((error) => reportDevError(el, `redo failed: ${String(error)}`, error));
      return;
    }
    if (isTextInputTarget(event.target)) return;
    if (event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyN" && event.shiftKey) {
      event.preventDefault();
      void addNode(nextAutoNodeLabel(), { seedPosition: preferredSpawnWorldPos(), zoomOutFactor: 0.96 });
      emitUiDebugLog("ui.keydown", { code: event.code, mode: "auto-create" }, 50);
      return;
    }
    if (event.code === "KeyN" && !event.shiftKey) {
      event.preventDefault();
      void promptAndCreateNode(preferredSpawnWorldPos());
      emitUiDebugLog("ui.keydown", { code: event.code, mode: "prompt-create" }, 50);
    }
  });

  installTestHook(store, () => ({
    projectId: el.graphSpaceId.value,
    graphSpaceId: el.graphSpaceId.value,
    localCursorKey: cursorStorageKey(normalizePrincipal(el.principal.value), el.graphSpaceId.value)
  }));
  void refreshProjects();
  syncSession += 1;
  void connectAndSync(syncSession);

  async function refreshProjects(): Promise<void> {
    const response = await fetch(`${el.baseUrl.value}/v1/projects`);
    if (!response.ok) return;
    const projects = (await response.json()) as Array<{ projectId: string; headCursor?: { graphSeq: number }; minReadableCursor?: { graphSeq: number } }>;
    el.projectsList.innerHTML = projects
      .map((project) => `<button data-project-id="${escapeHtml(project.projectId)}" style="display:block;margin-top:4px;">${escapeHtml(project.projectId)} (head=${project.headCursor?.graphSeq ?? 0}, min=${project.minReadableCursor?.graphSeq ?? 0})</button>`)
      .join("");
    for (const button of Array.from(el.projectsList.querySelectorAll("button[data-project-id]"))) {
      button.addEventListener("click", () => {
        const projectId = (button as HTMLButtonElement).dataset.projectId;
        if (!projectId) return;
        el.graphSpaceId.value = projectId;
        syncSession += 1;
        void connectAndSync(syncSession);
      });
    }
  }

  async function createProject(): Promise<void> {
    const requested = window.prompt("projectId (empty = uuid)", "") ?? "";
    const response = await fetch(`${el.baseUrl.value}/v1/projects`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({ projectId: requested || undefined })
    });
    const payload = (await response.json()) as { projectId: string };
    el.projectReport.textContent = `created project ${payload.projectId}`;
    await refreshProjects();
  }

  async function savePolicy(): Promise<void> {
    const body = {
      ttlSeconds: Number(el.policyTtl.value) || undefined,
      maxEvents: Number(el.policyMaxEvents.value) || undefined,
      snapshotEveryNEvents: Number(el.policyEveryN.value) || 1,
      snapshotEverySeconds: Number(el.policyEverySeconds.value) || 1,
      minSnapshotsToKeep: Number(el.policyMinSnapshots.value) || 1,
      mode: "delete"
    };
    const response = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/retention`, {
      method: "PATCH",
      headers: headers(el.principal.value),
      body: JSON.stringify(body)
    });
    const payload = await response.json() as { retentionPolicy?: Record<string, unknown> };
    el.projectReport.textContent = `effective policy projectId=${el.graphSpaceId.value} graphSpaceId=${el.graphSpaceId.value} => ${JSON.stringify(payload.retentionPolicy ?? {})}`;
  }

  async function createSnapshot(): Promise<void> {
    const response = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/snapshots:create`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({ label: "ui" })
    });
    el.projectReport.textContent = `snapshot create status=${response.status}`;
  }

  async function listSnapshots(): Promise<void> {
    const response = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/snapshots`, { headers: headers(el.principal.value) });
    const payload = (await response.json()) as Array<{ snapshotId: string; graphSpaceId?: string }>;
    el.projectReport.textContent = `snapshots=${payload.map((entry) => `${entry.snapshotId}@${entry.graphSpaceId ?? "n/a"}`).join(", ")}`;
  }

  async function forkLatestSnapshot(): Promise<void> {
    const listed = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/snapshots`, { headers: headers(el.principal.value) });
    const payload = (await listed.json()) as Array<{ snapshotId: string }>;
    const latest = payload[0];
    if (!latest) return;
    const response = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/snapshots/${encodeURIComponent(latest.snapshotId)}:fork`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({})
    });
    const fork = (await response.json()) as { newProjectId: string };
    el.projectReport.textContent = `forked => ${fork.newProjectId}`;
    await refreshProjects();
    el.graphSpaceId.value = fork.newProjectId;
    syncSession += 1;
    void connectAndSync(syncSession);
  }

  async function purgeHistoryDryRun(): Promise<void> {
    const response = await fetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/history:purge`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({ dryRun: true })
    });
    el.projectReport.textContent = `purge report: ${await response.text()}`;
  }

  async function connectAndSync(sessionId: number): Promise<void> {
    activeAbort = rotateAbortController(activeAbort);
    store.resetProjection();
    syncIngestionState.cursor = { metaSeq: 0, graphSeq: 0 };
    syncIngestionState.seenEventIdsByGraphSpace.clear();
    canvasRenderer?.clearTransientUiState();
    resetAutoFitState();
    setConnectionStatus("connecting");
    const normalizedPrincipal = normalizePrincipal(el.principal.value);
    const storageKey = cursorStorageKey(normalizedPrincipal, el.graphSpaceId.value);
    const bootstrapCacheKey = bootstrapCacheStorageKey(normalizedPrincipal, el.graphSpaceId.value);
    const savedCursor = readCursor(storageKey);
    const bootstrapCache = readBootstrapCacheRecord(bootstrapCacheKey, (key) => localStorage.getItem(key));
    const snapshot = await fetchSnapshot(normalizedPrincipal);
    const snapshotCursor = snapshot.cursor;
    const bootstrapDecision = resolveBootstrapCursorDecision({ savedCursor, snapshot: { cursor: snapshotCursor }, bootstrapCache });
    bootstrapReplayPending = true;
    if (bootstrapDecision.invalidateBootstrapCache) {
      clearBootstrapCacheRecord(bootstrapCacheKey, (key) => localStorage.removeItem(key));
    }
    if (bootstrapDecision.usedSavedCursor && bootstrapCache) {
      hydrateStoreFromProjection(store, bootstrapCache.projection);
      store.setCursor(bootstrapDecision.bootstrapFrom);
    } else {
      bootstrapFromSnapshot(snapshot);
    }

    const bootstrapCursor = bootstrapDecision.bootstrapFrom;
    syncIngestionState.cursor = bootstrapCursor;
    emitMeshDebugLog("BOOTSTRAP_DECISION", {
      graphSpaceId: el.graphSpaceId.value,
      principal: normalizedPrincipal,
      savedCursor,
      snapshotCursor,
      bootstrapCursor,
      decisionReason: bootstrapDecision.reason,
      usedSavedCursor: bootstrapDecision.usedSavedCursor
    });
    emitMeshDebugLog("BOOTSTRAP_REPLAY_STARTED", {
      graphSpaceId: el.graphSpaceId.value,
      fromCursor: bootstrapCursor,
      decisionReason: bootstrapDecision.reason
    });
    const replayResult = await pollReplayFromCursor(bootstrapCursor, sessionId, activeAbort.signal);
    if (sessionId !== syncSession) {
      bootstrapReplayPending = false;
      return;
    }
    bootstrapReplayPending = false;
    rebuildProjectionAfterBootstrap(replayResult.cursor, "poll-replay");
    emitMeshDebugLog("BOOTSTRAP_REPLAY_COMPLETED", {
      graphSpaceId: el.graphSpaceId.value,
      finalCursor: replayResult.cursor,
      graphEventsApplied: replayResult.graphEventsApplied
    });
    persistBootstrapCursor(storageKey, bootstrapCacheKey, snapshotCursor, replayResult.cursor, !bootstrapReplayPending);
    setConnectionStatus("connected (poll-only)");
    void subscribeLoop(sessionId, activeAbort.signal);


    async function fetchSnapshot(principalValue: string): Promise<{ payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor: Cursor }> {
      const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:snapshot`, { headers: headers(principalValue) }, {
        principal: principalValue,
        transport: "fetch",
        debugAuth,
        onNetworkResult: (status) => markNetworkConnectivity(status, "snapshot-bootstrap")
      });
      if (!response.ok) return { payload: { nodes: [], links: [] }, cursor: { metaSeq: 0, graphSeq: 0 } };
      const snapshot = (await response.json()) as { payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor?: Cursor };
      return { payload: snapshot.payload, cursor: snapshot.cursor ?? { metaSeq: 0, graphSeq: 0 } };
    }

    function bootstrapFromSnapshot(snapshot: { payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor: Cursor }): void {
      const nodes = snapshot.payload?.nodes ?? [];
      const links = snapshot.payload?.links ?? [];
      store.resetProjection();
      store.applyGraphEvents(nodes.map((node) => ({ type: "graph.node.created", node } as GraphEvent)));
      store.applyGraphEvents(links.map((link) => ({ type: "graph.link.created", link } as GraphEvent)));
      store.setCursor(snapshot.cursor);
    }

    async function subscribeLoop(activeSessionId: number, signal: AbortSignal): Promise<void> {
      activeSyncSubscriptions += 1;
      let retryDelayMs = SUBSCRIBE_RETRY_DELAY_MS;
      let lastSubscribeErrorLogAt = 0;
      try {
        while (activeSessionId === syncSession) {
          try {
            const subscribeBaseUrl = normalizeBaseUrl(el.subscribeBaseUrl.value) || normalizeBaseUrl(el.baseUrl.value);
            const url = `${subscribeBaseUrl}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:subscribe?from=${store.getState().cursor.graphSeq}`;
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
                const fromCursor = store.getState().cursor;
                const decision = evaluateSubscribeConvergence(fromCursor.graphSeq, txBundles);
                if (decision.action === "fallback-poll") {
                  emitMeshDebugLog("SUBSCRIBE_CURSOR_GUARD", {
                    reason: decision.reason,
                    fromCursor,
                    expectedGraphSeq: decision.expectedGraphSeq,
                    subscribePrincipalCursor: decision.subscribePrincipalCursor,
                    txBundleCount: txBundles.length,
                    graphEventsCount: decision.graphEventsCount
                  });
                  const replayResult = await pollReplayFromCursor(fromCursor, activeSessionId, signal);
                  if (activeSessionId !== syncSession) return;
                  persistBootstrapCursor(storageKey, bootstrapCacheKey, fromCursor, replayResult.cursor, !bootstrapReplayPending);
                  continue;
                }

                const graphEvents = extractGraphEventsFromTxBundles(txBundles);
                const next = { ...fromCursor, graphSeq: decision.expectedGraphSeq };
                const advanced = applyCursorIfAdvanced(storageKey, bootstrapCacheKey, next, "sse", graphEvents);
                if (advanced) {
                  setLastSyncNow();
                } else {
                  emitMeshDebugLog("SUBSCRIBE_DROP", {
                    reason: "cursor-not-advanced",
                    from: fromCursor,
                    candidate: next,
                    txBundleCount: txBundles.length,
                    graphEventsCount: graphEvents.length
                  });
                }
                continue;
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
      } finally {
        activeSyncSubscriptions = Math.max(0, activeSyncSubscriptions - 1);
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
            if (response.status === 410) {
              const nextSnapshot = await fetchSnapshot(normalizedPrincipal);
              bootstrapFromSnapshot(nextSnapshot);
              return { cursor: nextSnapshot.cursor, graphEventsApplied };
            }
            markNetworkConnectivity(response.status === 0 ? "offline" : "degraded", "poll-non-ok");
            reportDevError(el, `sync poll non-ok: ${response.status}`);
            return { cursor, graphEventsApplied };
          }
          const payload = (await response.json()) as SyncPollPayload;
          markNetworkConnectivity("online", "poll-success");
          const graphEvents = (payload.graph ?? [])
            .map((entry) => {
              const event = asGraphEvent(entry.payload);
              if (!event || typeof entry.eventId !== "string" || !entry.eventId) return null;
              return { eventId: entry.eventId, event };
            })
            .filter((entry): entry is IngestibleGraphEvent => entry !== null);
          const nextCursor = payload.cursorAfter ?? cursor;
          const nextMonotonic = nextMonotonicCursor(cursor, nextCursor);
          const cursorUnchanged = cursorEq(nextMonotonic, cursor);
          emitMeshDebugLog("APPLY_BATCH", {
            source: "poll",
            fromCursor: cursor,
            toCursor: nextMonotonic,
            graphEvents: graphEvents.length,
            metaEvents: payload.meta?.length ?? 0,
            cursorUnchanged
          });
          if (!cursorUnchanged) {
            const advanced = applyCursorIfAdvanced(storageKey, bootstrapCacheKey, nextMonotonic, "poll", graphEvents);
            if (advanced) {
              graphEventsApplied += graphEvents.length;
              emitMeshDebugLog("BOOTSTRAP_REPLAY_APPLIED", {
                graphSpaceId: el.graphSpaceId.value,
                fromCursor: cursor,
                toCursor: nextMonotonic,
                appliedGraphEvents: graphEvents.length
              });
              setLastSyncNow();
            }
          }
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

  async function addNode(label: string, opts: { seedPosition?: { x: number; y: number }; zoomOutFactor?: number } = {}): Promise<void> {
    try {
      const node: GraphNode = { id: crypto.randomUUID(), label };
      await undoRedo.recordCreateNode(node, { renameNode, deleteLink, deleteNode, createNodeFromSnapshot, createLinkFromSnapshot });
      if (opts.seedPosition) pendingSpawnSeeds.push(opts.seedPosition);
      if (opts.zoomOutFactor) canvasRenderer?.nudgeZoomOut(opts.zoomOutFactor);
    } catch (error) {
      reportDevError(el, `add node failed: ${String(error)}`, error);
    }
  }

  async function promptAndCreateNode(seedPosition?: { x: number; y: number }): Promise<void> {
    const label = prompt("Node label", nextAutoNodeLabel()) ?? "";
    if (!label) return;
    dbg("add-node:submit", { label });
    await addNode(label, { seedPosition });
  }

  function preferredSpawnWorldPos(): { x: number; y: number } {
    if (canvasRenderer) return canvasRenderer.getPreferredSpawnWorldPos();
    const rect = el.graphCanvas.getBoundingClientRect();
    return {
      x: cameraInfo.x + rect.width / (2 * cameraInfo.zoom),
      y: cameraInfo.y + rect.height / (2 * cameraInfo.zoom)
    };
  }

  function nextAutoNodeLabel(): string {
    const used = new Set<number>();
    for (const node of store.getState().nodesById.values()) {
      const match = /^Node\s+(\d+)$/.exec(node.label.trim());
      if (match) used.add(Number.parseInt(match[1]!, 10));
    }
    let index = 1;
    while (used.has(index)) index += 1;
    return `Node ${index}`;
  }

  function applyPendingSpawnSeeds(nodesById: Map<string, GraphNode>): void {
    const nextNodeIds = new Set(nodesById.keys());
    const addedNodeIds = Array.from(nextNodeIds).filter((id) => !previousNodeIds.has(id)).sort((left, right) => left.localeCompare(right));
    for (const nodeId of addedNodeIds) {
      const seed = pendingSpawnSeeds.shift();
      if (!seed) break;
      canvasRenderer?.seedNodePosition(nodeId, seed);
    }
    previousNodeIds = nextNodeIds;
  }

  function scheduleAutoFit(): void {
    if (autoFitApplied || hasUserMovedCamera || autoFitRaf !== 0) return;
    autoFitRaf = requestAnimationFrame(() => {
      autoFitRaf = 0;
      requestAnimationFrame(() => {
        if (autoFitApplied || hasUserMovedCamera || store.getState().nodesById.size === 0) return;
        const applied = fitCameraToCurrentGraph();
        if (applied) autoFitApplied = true;
      });
    });
  }

  function resetAutoFitState(): void {
    autoFitApplied = false;
    hasUserMovedCamera = false;
    previousNodeCount = 0;
    pendingSpawnSeeds.length = 0;
    previousNodeIds = new Set(store.getState().nodesById.keys());
    if (autoFitRaf !== 0) {
      cancelAnimationFrame(autoFitRaf);
      autoFitRaf = 0;
    }
  }

  function maybeRunImportProgressiveFit(data: GraphData): void {
    if (!isImporting) return;
    if (!layoutUiState.settings.cinematicFitOnImport) return;
    const now = performance.now();
    const minIntervalMs = 1000 / Math.max(1, layoutUiState.settings.cinematicFitRate);
    if (now - importLastProgressiveFitAt < minIntervalMs) return;
    const before = uiState.camera.zoom;
    const applied = fitCameraToCurrentGraph({ markAutoFitApplied: false, maxZoom: before });
    if (applied) importLastProgressiveFitAt = now;
  }

  async function createLinkFromDraft(source: string, target: string): Promise<void> {
    const type = el.linkType.value.trim() || "related";
    try {
      const link: GraphLink = { id: crypto.randomUUID(), source, target, type };
      await undoRedo.recordCreateLink(link, { renameNode, deleteLink, deleteNode, createNodeFromSnapshot, createLinkFromSnapshot });
    } catch (error) {
      reportDevError(el, `add link failed: ${String(error)}`, error);
    }
  }

  async function createNodeFromSnapshot(node: GraphNode): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:nodes`, {
      method: "POST",
      headers: headers(el.principal.value, idempotencyKey),
      body: JSON.stringify({ ...node, idempotencyKey })
    }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "create-node-snapshot") });
    if (!response.ok) throw new Error(`create node failed: ${response.status}`);
  }

  async function createLinkFromSnapshot(link: GraphLink): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:links`, {
      method: "POST",
      headers: headers(el.principal.value, idempotencyKey),
      body: JSON.stringify({ ...link, idempotencyKey })
    }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "create-link-snapshot") });
    if (!response.ok) throw new Error(`create link failed: ${response.status}`);
  }

  async function deleteLink(linkId: string): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
      headers: headers(el.principal.value, idempotencyKey)
    }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "delete-link") });
    if (!response.ok) throw new Error(`delete link failed: ${response.status}`);
  }

  async function deleteNode(nodeId: string): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:nodes/${encodeURIComponent(nodeId)}`, {
      method: "DELETE",
      headers: headers(el.principal.value, idempotencyKey)
    }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "delete-node") });
    if (!response.ok) throw new Error(`delete node failed: ${response.status}`);
  }

  async function renameNode(nodeId: string, label: string): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const response = await meshFetch(`${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/graph:nodes/${encodeURIComponent(nodeId)}`, {
      method: "PATCH",
      headers: headers(el.principal.value, idempotencyKey),
      body: JSON.stringify({ label, idempotencyKey })
    }, { principal: el.principal.value, transport: "fetch", debugAuth, onNetworkResult: (status) => markNetworkConnectivity(status, "rename-node") });
    if (!response.ok) throw new Error(`rename node failed: ${response.status}`);
  }

  function exportGraph(): ExportedGraphV1 {
    return exportGraphFromState(store.getState());
  }

  async function importGraph(data: ExportedGraphV1, mode: "merge" | "import" | "add" = "merge"): Promise<void> {
    const report = { mode, createdNodes: 0, createdLinks: 0, ignoredNodes: 0, ignoredLinks: 0, renamedNodes: 0, renamedLinks: 0 };
    if (mode === "import") {
      await clearGraph(true);
      undoRedo.reset();
    }
    resetAutoFitState();
    isImporting = true;
    importExpectedNodes = data.nodes.length;
    importExpectedLinks = data.links.length;
    importLastProgressiveFitAt = 0;

    const existingNodeIds = new Set(store.getState().nodesById.keys());
    const existingLinkIds = new Set(store.getState().linksById.keys());
    const nodeIdMap = new Map<string, string>();

    for (let index = 0; index < data.nodes.length; index += 1) {
      const node = data.nodes[index]!;
      reportDevInfo(el, `importing nodes ${index + 1}/${data.nodes.length}`);
      if (mode === "merge" && existingNodeIds.has(node.id)) {
        report.ignoredNodes += 1;
        continue;
      }
      const nextNode = mode === "add" && existingNodeIds.has(node.id)
        ? { ...node, id: `${node.id}__imported_${index + 1}` }
        : node;
      if (nextNode.id !== node.id) report.renamedNodes += 1;
      nodeIdMap.set(node.id, nextNode.id);
      await createNodeFromSnapshot(nextNode);
      report.createdNodes += 1;
      existingNodeIds.add(nextNode.id);
    }

    for (let index = 0; index < data.links.length; index += 1) {
      const link = data.links[index]!;
      reportDevInfo(el, `importing links ${index + 1}/${data.links.length}`);
      const sourceId = nodeIdMap.get(link.source) ?? link.source;
      const targetId = nodeIdMap.get(link.target) ?? link.target;
      if (!existingNodeIds.has(sourceId) || !existingNodeIds.has(targetId)) {
        report.ignoredLinks += 1;
        continue;
      }
      if (mode === "merge" && existingLinkIds.has(link.id)) {
        report.ignoredLinks += 1;
        continue;
      }
      const nextLink = mode === "add" && existingLinkIds.has(link.id)
        ? { ...link, id: `${link.id}__imported_${index + 1}`, source: sourceId, target: targetId }
        : { ...link, source: sourceId, target: targetId };
      if (nextLink.id !== link.id) report.renamedLinks += 1;
      await createLinkFromSnapshot(nextLink);
      report.createdLinks += 1;
      existingLinkIds.add(nextLink.id);
    }
    await waitForImportQuiescence();
    isImporting = false;
    fitCameraToCurrentGraph({ markAutoFitApplied: true });
    reportDevInfo(el, `import report ${JSON.stringify(report)}`);
  }

  async function clearGraph(skipUndoReset = false): Promise<void> {
    if (!skipUndoReset) undoRedo.reset();
    resetAutoFitState();
    const nodeIds = Array.from(store.getState().nodesById.keys());
    for (let index = 0; index < nodeIds.length; index += 1) {
      reportDevInfo(el, `clearing ${index + 1}/${nodeIds.length}`);
      await deleteNode(nodeIds[index]);
    }
  }

  function currentSelection(): Selection {
    const selectedNodeId = store.getState().selectedNodeIds.values().next().value as string | undefined;
    const selectedLinkId = store.getState().selectedLinkIds.values().next().value as string | undefined;
    if (selectedNodeId) return { kind: "node", nodeId: selectedNodeId };
    if (selectedLinkId) return { kind: "link", linkId: selectedLinkId };
    return { kind: "none" };
  }

  async function requestDelete(_selection?: Selection): Promise<void> {
    try {
      const state = store.getState();
      const plan = buildMultiDeletePlan(state, state.selectedLinkIds);
      if (plan.nodeIds.length === 0 && plan.linkIds.length === 0) return;

      const nodes = plan.nodeIds.map((nodeId) => state.nodesById.get(nodeId)).filter((node): node is GraphNode => Boolean(node));
      const selectedNodeSet = new Set(plan.nodeIds);
      const implicitLinks = Array.from(state.linksById.values()).filter((link) => selectedNodeSet.has(link.source) || selectedNodeSet.has(link.target));
      const explicitLinks = plan.linkIds.map((linkId) => state.linksById.get(linkId)).filter((link): link is GraphLink => Boolean(link));
      const linkById = new Map<string, GraphLink>();
      for (const link of [...implicitLinks, ...explicitLinks]) linkById.set(link.id, link);

      await undoRedo.recordMultiDelete(nodes, Array.from(linkById.values()), { renameNode, deleteLink, deleteNode, createNodeFromSnapshot, createLinkFromSnapshot });

      store.clearSelection();
    } catch (error) {
      reportDevError(el, `delete failed: ${String(error)}`, error);
    }
  }

  async function waitForImportQuiescence(timeoutMs = 1200): Promise<void> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const state = store.getState();
      if (state.nodesById.size >= importExpectedNodes && state.linksById.size >= importExpectedLinks) return;
      await wait(60);
    }
  }

  async function requestRename(nodeId: string): Promise<void> {
    const node = store.getState().nodesById.get(nodeId);
    if (!node) return;
    const nextLabel = prompt("Node label", node.label)?.trim();
    if (!nextLabel || nextLabel === node.label) return;
    try {
      await undoRedo.recordRename(nodeId, node.label, nextLabel, { renameNode, deleteLink, deleteNode, createNodeFromSnapshot, createLinkFromSnapshot });
    } catch (error) {
      reportDevError(el, `rename failed: ${String(error)}`, error);
    }
  }

  function setupRenderer(): void {
    try {
      const viewportActions: GraphViewportActions = {
        onSelect: () => undefined,
        onRequestDelete: (selection) => {
          void requestDelete(selection);
        },
        onRequestRename: (nodeId) => {
          void requestRename(nodeId);
        },
        onCreateLink: (source, target) => {
          void createLinkFromDraft(source, target);
        }
      };
      const initialModel: GraphViewportModel = { nodes: [], links: [], selectedNodeIds: new Set(), selectedLinkIds: new Set() };
      canvasRenderer = new CanvasGraphViewport2D(el.graphCanvas, {
        model: initialModel,
        actions: viewportActions,
        options: { connectivity: "degraded", debug: layoutUiState.settings.debugLogs },
        uiState,
        camera: cameraInfo,
        onSelectionReplaceNodeIds: (ids) => store.replaceSelection(ids),
        onSelectionToggleNodeId: (id) => store.toggleSelectNode(id),
        onSelectionClear: () => store.clearSelection(),
        onSelectedLinkIdsChange: (ids) => {
          store.replaceLinkSelection(ids);
        },
        onEdgeDraftChange: (edgeDraft) => {
          uiState.edgeDraft = edgeDraft;
          updateSelectionUi(store.getState());
          canvasRenderer?.update({
            nodes: Array.from(store.getState().nodesById.values()),
            links: Array.from(store.getState().linksById.values()),
            selectedNodeIds: store.getState().selectedNodeIds,
            selectedLinkIds: store.getState().selectedLinkIds
          }, uiState);
        },
        onCameraChange: (camera) => {
          hasUserMovedCamera = true;
          if (autoFitRaf !== 0) {
            cancelAnimationFrame(autoFitRaf);
            autoFitRaf = 0;
          }
          cameraInfo = camera;
          queueBadgeRender();
        },
        onFitRequest: () => {
          fitCameraToCurrentGraph();
        },
        layoutParams: deriveLayoutParams(layoutUiState.settings),
        warmupMode: layoutUiState.settings.warmupMode,
        debugLogsEnabled: layoutUiState.settings.debugLogs,
        debugLog: emitUiDebugLog
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
        const previous = layoutUiState.settings;
        layoutUiState = { ...layoutUiState, settings: next };
        saveLayoutUiState(layoutUiState);
        canvasRenderer?.setDebugLogsEnabled(next.debugLogs);
        canvasRenderer?.setLayoutParams(deriveLayoutParams(next));
        canvasRenderer?.setWarmupMode(next.warmupMode);
        emitUiDebugLog("settings.change", { previous, next });
      },
      onPanelStateChange: (panel) => {
        layoutUiState = { ...layoutUiState, panel };
        saveLayoutUiState(layoutUiState);
      },
      onReheat: () => {
        emitUiDebugLog("ui.keydown", { key: "Reheat" });
        canvasRenderer?.reheat();
      },
      onFit: () => {
        emitUiDebugLog("ui.keydown", { key: "Fit" });
        fitCameraToCurrentGraph();
      },
      onExportGraph: async () => {
        try {
          const payload = exportGraph();
          const json = JSON.stringify(payload, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "mesh-graph.json";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(json);
          }
          reportDevInfo(el, `graph exported (${payload.nodes.length} nodes, ${payload.links.length} links)`);
        } catch (error) {
          reportDevError(el, `graph export failed: ${String(error)}`, error);
        }
      },
      onImportGraph: (file, importMode) => {
        void (async () => {
          try {
            reportDevInfo(el, `reading ${file.name}...`);
            const raw = await file.text();
            const parsed = parseExportedGraph(JSON.parse(raw));
            await importGraph(parsed, importMode);
            reportDevInfo(el, `graph imported (${parsed.nodes.length} nodes, ${parsed.links.length} links)`);
          } catch (error) {
            reportDevError(el, `graph import failed: ${String(error)}`, error);
          }
        })();
      },
      onClearGraph: () => {
        if (!window.confirm("Are you sure you want to clear the graph?")) return;
        void clearGraph()
          .then(() => reportDevInfo(el, "graph cleared"))
          .catch((error) => reportDevError(el, `graph clear failed: ${String(error)}`, error));
      }
    });
  }

  function fitCameraToCurrentGraph(options: { markAutoFitApplied?: boolean; maxZoom?: number } = {}): boolean {
    const positioned = Array.from((canvasRenderer?.getNodePositions() ?? new Map()).values()).map((position) => ({ position }));
    const bounds = computeGraphBounds(positioned);
    if (!bounds) return false;
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (!Number.isFinite(boundsWidth) || !Number.isFinite(boundsHeight) || boundsWidth < 1 || boundsHeight < 1) return false;
    const rect = el.graphCanvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 2 || rect.height < 2) return false;
    const nextCamera = fitCameraToBounds(bounds, { width: rect.width, height: rect.height }, uiState.camera, 0.12, store.getState().nodesById.size);
    uiState.camera = options.maxZoom !== undefined && nextCamera.zoom > options.maxZoom ? { ...nextCamera, zoom: options.maxZoom } : nextCamera;
    if (options.markAutoFitApplied) autoFitApplied = true;
    cameraInfo = uiState.camera;
    queueBadgeRender();
    canvasRenderer?.update({
      nodes: Array.from(store.getState().nodesById.values()),
      links: Array.from(store.getState().linksById.values()),
      selectedNodeIds: store.getState().selectedNodeIds,
      selectedLinkIds: store.getState().selectedLinkIds
    }, uiState);
    return true;
  }

  function updateSelectionUi(snapshot: GraphState): void {
    const selectedNodes = Array.from(snapshot.selectedNodeIds);
    const selectedLinks = Array.from(snapshot.selectedLinkIds);
    if (uiState.edgeDraft) {
      const from = snapshot.nodesById.get(uiState.edgeDraft.startNodeId)?.label ?? uiState.edgeDraft.startNodeId;
      el.linkSelectionHint.textContent = `Draft: ${from} → (click destination node, Escape to cancel)`;
      return;
    }
    if (selectedNodes.length === 0 && selectedLinks.length === 0) {
      el.linkSelectionHint.textContent = "Click to select. Ctrl/Cmd+click starts link draft. Shift+click extends selection.";
      return;
    }
    el.linkSelectionHint.textContent = `Selected nodes: ${selectedNodes.length} • links: ${selectedLinks.length}`;
  }

  function renderStatus(snapshot: GraphState, nodes: number, links: number): void {
    el.status.textContent = `Connectivity: ${formatConnectivity(connectivityState)}`;
    el.transport.textContent = `transport: ${snapshot.connectionStatus}`;
    el.lastCursor.textContent = `cursor: ${JSON.stringify(snapshot.cursor)}`;
    el.lastSync.textContent = `last sync: ${snapshot.lastSync}`;
    (window as Window & { __meshRuntimeStats?: unknown }).__meshRuntimeStats = {
      activeSyncSubscriptions,
      activeCinematicFitRafs: autoFitRaf !== 0 ? 1 : 0,
      isImporting
    };
    badgeStats = { nodes, links };
    queueBadgeRender();
    if (!el.principal.value.trim()) {
      el.transport.textContent = `transport: principal required, default "${DEFAULT_PRINCIPAL}" via x-mesh-principal`;
    }
  }

  function emitUiDebugLog(event: string, payload: Record<string, unknown> = {}, throttleMs = 0): void {
    if (!layoutUiState.settings.debugLogs) return;
    const now = Date.now();
    if (throttleMs > 0) {
      const last = debugThrottleByEvent.get(event) ?? 0;
      if (now - last < throttleMs) return;
      debugThrottleByEvent.set(event, now);
    }
    console.debug("[mesh-ui]", { event, t: now, ...payload });
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
      emitUiDebugLog("connectivity.change", { source, connectivityState, browserConnectivityHint, networkConnectivityHint });
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

  function applyCursorIfAdvanced(
    storageKey: string,
    bootstrapCacheKey: string,
    candidate: Cursor,
    source: "poll" | "sse" | "replay",
    graphEvents: IngestibleGraphEvent[]
  ): boolean {
    const current = store.getState().cursor;
    if (compareCursor(candidate, current) <= 0) {
      emitMeshDebugLog("cursor-regression", { source, current, candidate });
      return false;
    }
    const result = applyGuardedSyncBatch({
      graphSpaceId: el.graphSpaceId.value,
      state: syncIngestionState,
      source,
      candidateCursor: candidate,
      events: graphEvents,
      applyGraphEvents: (events) => store.applyGraphEvents(events),
      log: (message, detail) => emitMeshDebugLog(message, detail)
    });
    if (!result.cursorAdvanced) return false;
    store.setCursor(candidate);
    if (bootstrapReplayPending) {
      emitMeshDebugLog("BOOTSTRAP_CACHE_WRITE_DEFERRED", {
        source,
        candidate,
        reason: "replay-pending"
      });
      return true;
    }
    persistDurableBootstrapState(storageKey, bootstrapCacheKey, candidate, createProjectionSnapshot(store));
    emitMeshDebugLog("BOOTSTRAP_CACHE_WRITE_COMMITTED", {
      source,
      cursor: candidate
    });
    return true;
  }

  function rebuildProjectionAfterBootstrap(finalCursor: Cursor, reason: string): void {
    const projection = createProjectionSnapshot(store);
    hydrateStoreFromProjection(store, projection);
    store.setCursor(finalCursor);
    emitMeshDebugLog("PROJECTION_REBUILD_AFTER_BOOTSTRAP", {
      reason,
      cursor: finalCursor,
      nodesCount: projection.nodes.length,
      linksCount: projection.links.length
    });
    emitMeshDebugLog("VISIBLE_STATE_AFTER_BOOTSTRAP", {
      cursor: finalCursor,
      nodesCount: projection.nodes.length,
      linksCount: projection.links.length
    });
  }

  function persistBootstrapCursor(
    storageKey: string,
    bootstrapCacheKey: string,
    fromCursor: Cursor,
    finalCursor: Cursor,
    replayComplete: boolean
  ): void {
    const current = store.getState().cursor;
    if (!shouldPersistBootstrapCursor(fromCursor, finalCursor, current, replayComplete)) return;
    store.setCursor(finalCursor);
    persistDurableBootstrapState(storageKey, bootstrapCacheKey, finalCursor, createProjectionSnapshot(store));
    emitMeshDebugLog("BOOTSTRAP_CACHE_WRITE_COMMITTED", {
      source: "bootstrap-finalize",
      cursor: finalCursor
    });
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
  subscribeBaseUrl: HTMLInputElement;
  graphSpaceId: HTMLInputElement;
  principal: HTMLInputElement;
  connect: HTMLButtonElement;
  addNode: HTMLButtonElement;
  fitGraph: HTMLButtonElement;
  renameSelected: HTMLButtonElement;
  deleteSelected: HTMLButtonElement;
  undoAction: HTMLButtonElement;
  redoAction: HTMLButtonElement;
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
  projectsRefresh: HTMLButtonElement;
  projectCreate: HTMLButtonElement;
  projectsList: HTMLDivElement;
  policyTtl: HTMLInputElement;
  policyMaxEvents: HTMLInputElement;
  policyEveryN: HTMLInputElement;
  policyEverySeconds: HTMLInputElement;
  policyMinSnapshots: HTMLInputElement;
  policySave: HTMLButtonElement;
  snapshotCreate: HTMLButtonElement;
  snapshotList: HTMLButtonElement;
  snapshotFork: HTMLButtonElement;
  purgeNow: HTMLButtonElement;
  projectReport: HTMLDivElement;
};

function byId(container: HTMLElement): UiElements {
  return {
    baseUrl: container.querySelector("#baseUrl") as HTMLInputElement,
    subscribeBaseUrl: container.querySelector("#subscribeBaseUrl") as HTMLInputElement,
    graphSpaceId: container.querySelector("#graphSpaceId") as HTMLInputElement,
    principal: container.querySelector("#principal") as HTMLInputElement,
    connect: container.querySelector("#connect") as HTMLButtonElement,
    addNode: container.querySelector("#addNode") as HTMLButtonElement,
    fitGraph: container.querySelector("#fitGraph") as HTMLButtonElement,
    renameSelected: container.querySelector("#renameSelected") as HTMLButtonElement,
    deleteSelected: container.querySelector("#deleteSelected") as HTMLButtonElement,
    undoAction: container.querySelector("#undoAction") as HTMLButtonElement,
    redoAction: container.querySelector("#redoAction") as HTMLButtonElement,
    linkType: container.querySelector("#linkType") as HTMLInputElement,
    linkSelectionHint: container.querySelector("#linkSelectionHint") as HTMLDivElement,
    status: container.querySelector("#status") as HTMLDivElement,
    transport: container.querySelector("#transport") as HTMLDivElement,
    lastCursor: container.querySelector("#lastCursor") as HTMLDivElement,
    lastSync: container.querySelector("#lastSync") as HTMLDivElement,
    graphCanvas: container.querySelector("#graphCanvas") as HTMLCanvasElement,
    rendererBadge: container.querySelector("#rendererBadge") as HTMLDivElement,
    devBanner: container.querySelector("#devBanner") as HTMLDivElement,
    layoutPanelHost: container.querySelector("#layoutPanelHost") as HTMLDivElement,
    projectsRefresh: container.querySelector("#projectsRefresh") as HTMLButtonElement,
    projectCreate: container.querySelector("#projectCreate") as HTMLButtonElement,
    projectsList: container.querySelector("#projectsList") as HTMLDivElement,
    policyTtl: container.querySelector("#policyTtl") as HTMLInputElement,
    policyMaxEvents: container.querySelector("#policyMaxEvents") as HTMLInputElement,
    policyEveryN: container.querySelector("#policyEveryN") as HTMLInputElement,
    policyEverySeconds: container.querySelector("#policyEverySeconds") as HTMLInputElement,
    policyMinSnapshots: container.querySelector("#policyMinSnapshots") as HTMLInputElement,
    policySave: container.querySelector("#policySave") as HTMLButtonElement,
    snapshotCreate: container.querySelector("#snapshotCreate") as HTMLButtonElement,
    snapshotList: container.querySelector("#snapshotList") as HTMLButtonElement,
    snapshotFork: container.querySelector("#snapshotFork") as HTMLButtonElement,
    purgeNow: container.querySelector("#purgeNow") as HTMLButtonElement,
    projectReport: container.querySelector("#projectReport") as HTMLDivElement
  };
}

function headers(principal: string, idempotencyKey?: string): HeadersInit {
  const next: Record<string, string> = {
    "content-type": "application/json",
    "x-mesh-principal": normalizePrincipal(principal)
  };
  if (idempotencyKey) next["x-idempotency-key"] = idempotencyKey;
  return next;
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

function persistDurableBootstrapState(
  cursorStorage: string,
  cacheStorage: string,
  cursor: Cursor,
  projection: ReturnType<typeof createProjectionSnapshot>
): void {
  const record = makeBootstrapCacheRecord(cursor, projection);
  persistBootstrapCacheRecord(cacheStorage, cursorStorage, record, (key, value) => localStorage.setItem(key, value));
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

function extractGraphEventsFromTxBundles(txBundles: SyncTxBundle[]): IngestibleGraphEvent[] {
  const output: IngestibleGraphEvent[] = [];
  for (const item of txBundles) {
    const graphEvents = item.txBundle?.graphEvents ?? [];
    const txId = item.txBundle?.txId ?? "unknown";
    for (let index = 0; index < graphEvents.length; index += 1) {
      const raw = graphEvents[index];
      const event = asGraphEvent(raw);
      if (!event) continue;
      const eventId = resolveEventId(raw, txId, index);
      output.push({ eventId, event });
    }
  }
  return output;
}


function resolveEventId(value: unknown, txId: string, index: number): string {
  if (value && typeof value === "object" && "eventId" in value) {
    const maybeEventId = (value as { eventId?: unknown }).eventId;
    if (typeof maybeEventId === "string" && maybeEventId) return maybeEventId;
  }
  return `${txId}-graph-${index + 1}`;
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

function reportDevInfo(el: Pick<UiElements, "devBanner">, message: string): void {
  console.info("[mesh-explorer]", message);
  if (!isDebugEnabled()) return;
  el.devBanner.style.display = "block";
  el.devBanner.textContent = message;
}

type MeshDebugApi = {
  selectNodes: (ids: string[]) => void;
  dump: () => { projectId: string; graphSpaceId: string; head: number; minReadableCursor: number; cursor: Cursor; nodesCount: number; linksCount: number; localCursorKey: string };
  logs?: Array<{ message: string; detail?: unknown }>;
  log?: (message: string, detail?: unknown) => void;
};

function installTestHook(store: GraphStore, readContext: () => { projectId: string; graphSpaceId: string; localCursorKey: string }): void {
  const mode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (mode !== "test" && !isDebugEnabled()) return;
  const meshDebug: MeshDebugApi = {
    selectNodes(ids: string[]) {
      store.replaceSelection(ids);
    },
    dump() {
      const state = store.getState();
      const canvasStats = (window as Window & { __meshCanvasStats?: () => unknown }).__meshCanvasStats?.();
      const runtimeStats = (window as Window & { __meshRuntimeStats?: unknown }).__meshRuntimeStats;
      const context = readContext();
      return {
        projectId: context.projectId,
        graphSpaceId: context.graphSpaceId,
        head: state.cursor.graphSeq,
        minReadableCursor: 0,
        cursor: state.cursor,
        nodesCount: state.nodesById.size,
        linksCount: state.linksById.size,
        localCursorKey: context.localCursorKey,
        canvasStats,
        runtimeStats
      };
    },
    logs: [],
    log(message, detail) {
      this.logs?.push({ message, detail });
    }
  };
  (window as Window & { __meshDebug?: MeshDebugApi }).__meshDebug = meshDebug;
}

function cursorEq(a: Cursor, b: Cursor): boolean {
  return a.metaSeq === b.metaSeq && a.graphSeq === b.graphSeq;
}


function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function resolveMeshBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
  if (typeof env?.MESH_API_BASE_URL === "string" && env.MESH_API_BASE_URL.trim()) return normalizeBaseUrl(env.MESH_API_BASE_URL);
  const processEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (typeof processEnv?.MESH_API_BASE_URL === "string" && processEnv.MESH_API_BASE_URL.trim()) return normalizeBaseUrl(processEnv.MESH_API_BASE_URL);
  return "http://127.0.0.1:8090";
}

function resolveMeshSubscribeBaseUrl(defaultBaseUrl: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
  if (typeof env?.MESH_SUBSCRIBE_BASE_URL === "string" && env.MESH_SUBSCRIBE_BASE_URL.trim()) return normalizeBaseUrl(env.MESH_SUBSCRIBE_BASE_URL);
  const processEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (typeof processEnv?.MESH_SUBSCRIBE_BASE_URL === "string" && processEnv.MESH_SUBSCRIBE_BASE_URL.trim()) return normalizeBaseUrl(processEnv.MESH_SUBSCRIBE_BASE_URL);
  return defaultBaseUrl;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function emitMeshDebugLog(message: string, detail?: unknown): void {
  const devMode = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  emitMeshDebugLogToSinks(window, message, detail, { devMode });
}

function resolveConnectivityState(browserHint: ConnectivityStatus, networkHint: ConnectivityStatus): ConnectivityStatus {
  if (networkHint === "offline" || browserHint === "offline") return "offline";
  if (networkHint === "degraded") return "degraded";
  return "online";
}

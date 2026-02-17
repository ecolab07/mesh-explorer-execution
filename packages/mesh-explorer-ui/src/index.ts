import ForceGraph2D from "force-graph";
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
        <div id="status">disconnected</div>
        <div id="lastCursor">cursor: n/a</div>
        <div id="lastSync">last sync: n/a</div>
        <hr/>
        <button id="addNode">Add node</button>
        <div style="margin-top:8px;padding:8px;border:1px solid #ddd;border-radius:8px;">
          <div><strong>Create link</strong></div>
          <label>type <input id="linkType" style="width:100%" value="related"/></label>
          <div id="linkSelectionHint" style="margin-top:6px;font-size:12px;color:#555;">Select exactly two nodes in the graph.</div>
          <button id="addLink" style="margin-top:6px;" disabled>Create link</button>
        </div>
        <div id="devBanner" style="display:none;margin-top:8px;padding:6px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:12px;"></div>
      </aside>
      <main style="position:relative;display:grid;grid-template-rows:1fr 320px;gap:8px;padding:8px;">
        <div id="graph3d" style="border:1px solid #ddd;"></div>
        <div id="graph2d" style="border:1px solid #ddd;"></div>
        <div id="rendererBadge" style="position:absolute;top:16px;right:16px;padding:4px 8px;border-radius:999px;background:#111827;color:white;font-size:12px;opacity:0.85;"></div>
      </main>
    </section>
  `;

  const el = byId(container);
  const debugAuth = isDebugAuthEnabled();
  const debugEnabled = isDebugEnabled();
  const store = createGraphStore();
  let syncSession = 0;
  let graph2d: any = null;
  let rendererMode: "2d" | "fallback-json" = "2d";
  let activeAbort: AbortController | null = null;

  setConnectionStatus("disconnected");

  setupRenderer();
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
    graph2d?.graphData(data);
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

  el.addLink.onclick = () => {
    void addLinkFromSelection();
  };

  installTestHook(store);
  syncSession += 1;
  void connectAndSync(syncSession);

  async function connectAndSync(sessionId: number): Promise<void> {
    activeAbort = rotateAbortController(activeAbort);
    setConnectionStatus("connecting");
    const normalizedPrincipal = normalizePrincipal(el.principal.value);
    const storageKey = cursorStorageKey(normalizedPrincipal, el.graphSpaceId.value);
    const savedCursor = readCursor(storageKey) ?? { metaSeq: 0, graphSeq: 0 };
    const replayResult = await pollReplayFromCursor(savedCursor, sessionId, activeAbort.signal);
    if (sessionId !== syncSession) return;
    if (savedCursor.graphSeq > 0 && replayResult.graphEventsApplied === 0 && store.getState().nodesById.size === 0) {
      const fallbackReplay = await pollReplayFromCursor({ metaSeq: 0, graphSeq: 0 }, sessionId, activeAbort.signal);
      if (sessionId !== syncSession) return;
      applyCursorIfAdvanced(storageKey, fallbackReplay.cursor, "poll");
    } else {
      applyCursorIfAdvanced(storageKey, replayResult.cursor, "poll");
    }
    setConnectionStatus("connected (poll-only)");
    void subscribeLoop(sessionId, activeAbort.signal);

    async function subscribeLoop(activeSessionId: number, signal: AbortSignal): Promise<void> {
      while (activeSessionId === syncSession) {
        try {
          const url = `${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:subscribe?from=${store.getState().cursor.graphSeq}`;
          const response = await meshFetch(url, { headers: headers(normalizedPrincipal), signal }, {
            principal: normalizedPrincipal,
            transport: "fetch-sse",
            debugAuth
          });
          if (!response.body) {
            setConnectionStatus("reconnecting");
            await wait(300);
            continue;
          }
          setConnectionStatus("connected");
          for await (const data of parseSse(response.body)) {
            if (activeSessionId !== syncSession) return;
            if (data.kind === "heartbeat") {
              dbg("sync:heartbeat", data);
              continue;
            }
            if (data.kind === "txBundles") {
              const txBundles = data.txBundlesVisible ?? [];
              const cursorFromBundles = readCursorFromTxBundles(txBundles);
              if (cursorFromBundles !== null) {
                const next = { ...store.getState().cursor, graphSeq: cursorFromBundles };
                const advanced = applyCursorIfAdvanced(storageKey, next, "sse");
                if (advanced) {
                  const events = extractGraphEventsFromTxBundles(txBundles);
                  store.applyGraphEvents(events);
                  setLastSyncNow();
                  dbg("sync:txBundles", { count: events.length });
                }
                continue;
              }
              const events = extractGraphEventsFromTxBundles(txBundles);
              store.applyGraphEvents(events);
              setLastSyncNow();
              dbg("sync:txBundles:no-cursor", { count: events.length });
              continue;
            }
            if (data.kind === "cursor" && typeof data.cursorVisible === "number") {
              renderStatus(store.getState(), store.getState().nodesById.size, store.getState().linksById.size);
            }
          }
          if (activeSessionId === syncSession) {
            setConnectionStatus("reconnecting");
          }
        } catch (error) {
          if (signal.aborted) return;
          setConnectionStatus("reconnecting");
          reportDevError(el, `sync subscribe failed: ${String(error)}`, error);
          await wait(500);
        }
      }
    }

    async function pollReplayFromCursor(initialCursor: Cursor, activeSessionId: number, signal: AbortSignal): Promise<{ cursor: Cursor; graphEventsApplied: number }> {
      let cursor = initialCursor;
      let graphEventsApplied = 0;
      try {
        const limits = encodeURIComponent(JSON.stringify({ graph: 128, meta: 32 }));
        while (activeSessionId === syncSession) {
          const encodedCursor = encodeURIComponent(JSON.stringify(cursor));
          const response = await meshFetch(
            `${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:poll?cursor=${encodedCursor}&limits=${limits}`,
            { headers: headers(normalizedPrincipal), signal },
            { principal: normalizedPrincipal, transport: "fetch", debugAuth }
          );
          if (!response.ok) {
            reportDevError(el, `sync poll non-ok: ${response.status}`);
            return { cursor, graphEventsApplied };
          }
          const payload = (await response.json()) as SyncPollPayload;
          const graphEvents = (payload.graph ?? [])
            .map((entry) => asGraphEvent(entry.payload))
            .filter((event): event is GraphEvent => event !== null);
          const nextCursor = payload.cursorAfter ?? cursor;
          const advanced = applyCursorIfAdvanced(storageKey, nextCursor, "poll");
          if (advanced || graphEvents.length === 0) {
            graphEventsApplied += graphEvents.length;
            store.applyGraphEvents(graphEvents);
            if (graphEvents.length > 0) setLastSyncNow();
          }

          const metaCount = payload.meta?.length ?? 0;
          const graphCount = payload.graph?.length ?? 0;
          const cursorUnchanged = cursorEq(nextCursor, cursor);
          cursor = nextCursor;

          if ((metaCount === 0 && graphCount === 0) || cursorUnchanged) {
            break;
          }
        }
        return { cursor, graphEventsApplied };
      } catch (error) {
        if (signal.aborted) return { cursor, graphEventsApplied };
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
      }, { principal: el.principal.value, transport: "fetch", debugAuth });
      dbg("add-node:result", { ok: response.ok, status: response.status });
    } catch (error) {
      reportDevError(el, `add node failed: ${String(error)}`, error);
    }
  }

  async function addLinkFromSelection(): Promise<void> {
    const selected = Array.from(store.getState().selectedNodeIds);
    if (selected.length !== 2) {
      reportDevError(el, "Select exactly two nodes before creating a link.");
      return;
    }
    try {
      const [source, target] = selected;
      const type = el.linkType.value.trim() || "related";
      const response = await meshFetch(`${el.baseUrl.value}/graph/links`, {
        method: "POST",
        headers: headers(el.principal.value),
        body: JSON.stringify({ source, target, type, idempotencyKey: crypto.randomUUID() })
      }, { principal: el.principal.value, transport: "fetch", debugAuth });
      dbg("add-link:result", { ok: response.ok, status: response.status, source, target, type });
    } catch (error) {
      reportDevError(el, `add link failed: ${String(error)}`, error);
    }
  }

  function setupRenderer(): void {
    try {
      el.graph3d.style.display = "none";
      reportDevError(el, "3D renderer disabled (react-force-graph-3d is a React component; imperative 3D not wired).");

      graph2d = ForceGraph2D()(el.graph2d)
        .nodeId("id")
        .nodeLabel("label")
        .linkColor((link: unknown) => colorForType((link as GraphLink).type));
      graph2d.onNodeClick((node: GraphNode) => {
        store.toggleSelectNode(String(node.id));
      });

      setRendererMode("2d");
    } catch (error) {
      setRendererMode("fallback-json");
      el.graph3d.style.display = "none";
      el.graph2d.innerHTML = `<pre style="margin:0;padding:8px;overflow:auto;">Renderer fallback:\n${escapeHtml(String(error))}</pre>`;
      reportDevError(el, `renderer init failed: ${String(error)}`, error);
    }
  }

  function updateSelectionUi(snapshot: GraphState): void {
    const selected = Array.from(snapshot.selectedNodeIds);
    if (selected.length !== 2) {
      el.linkSelectionHint.textContent = `Select exactly two nodes in the graph (${selected.length}/2 selected).`;
      el.addLink.disabled = true;
      return;
    }
    const [fromId, toId] = selected;
    const from = snapshot.nodesById.get(fromId)?.label ?? fromId;
    const to = snapshot.nodesById.get(toId)?.label ?? toId;
    el.linkSelectionHint.textContent = `Link from ${from} to ${to}`;
    el.addLink.disabled = false;
  }

  function renderStatus(snapshot: GraphState, nodes: number, links: number): void {
    el.status.textContent = snapshot.connectionStatus;
    el.lastCursor.textContent = `cursor: ${JSON.stringify(snapshot.cursor)}`;
    el.lastSync.textContent = `last sync: ${snapshot.lastSync}`;
    el.rendererBadge.textContent = `Renderer: ${rendererMode} | nodes=${nodes} links=${links}`;
    if (!el.principal.value.trim()) {
      el.status.textContent = `principal required: sending default "${DEFAULT_PRINCIPAL}" via x-mesh-principal`;
    }
  }

  function setConnectionStatus(next: ConnectionStatus): void {
    store.setConnectionStatus(next);
  }

  function setLastSyncNow(): void {
    store.setLastSync(new Date().toISOString());
  }

  function applyCursorIfAdvanced(storageKey: string, candidate: Cursor, source: "poll" | "sse"): boolean {
    const current = store.getState().cursor;
    if (compareCursor(candidate, current) <= 0) {
      dbg(`cursor-regression:${source}`, { current, candidate });
      emitMeshDebugLog("cursor-regression", { source, current, candidate });
      return false;
    }
    store.setCursor(candidate);
    persistCursor(storageKey, candidate);
    return true;
  }

  function setRendererMode(mode: "2d" | "fallback-json"): void {
    rendererMode = mode;
    el.rendererBadge.textContent = `Renderer: ${rendererMode}`;
  }

  function dbg(message: string, detail?: unknown): void {
    if (!debugEnabled) return;
    console.info("[mesh-debug]", message, detail);
  }

  container.addEventListener("DOMNodeRemoved", () => {
    unsubscribe();
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
  addLink: HTMLButtonElement;
  linkType: HTMLInputElement;
  linkSelectionHint: HTMLDivElement;
  status: HTMLDivElement;
  lastCursor: HTMLDivElement;
  lastSync: HTMLDivElement;
  graph3d: HTMLDivElement;
  graph2d: HTMLDivElement;
  rendererBadge: HTMLDivElement;
  devBanner: HTMLDivElement;
};

function byId(container: HTMLElement): UiElements {
  return {
    baseUrl: container.querySelector("#baseUrl") as HTMLInputElement,
    graphSpaceId: container.querySelector("#graphSpaceId") as HTMLInputElement,
    principal: container.querySelector("#principal") as HTMLInputElement,
    connect: container.querySelector("#connect") as HTMLButtonElement,
    addNode: container.querySelector("#addNode") as HTMLButtonElement,
    addLink: container.querySelector("#addLink") as HTMLButtonElement,
    linkType: container.querySelector("#linkType") as HTMLInputElement,
    linkSelectionHint: container.querySelector("#linkSelectionHint") as HTMLDivElement,
    status: container.querySelector("#status") as HTMLDivElement,
    lastCursor: container.querySelector("#lastCursor") as HTMLDivElement,
    lastSync: container.querySelector("#lastSync") as HTMLDivElement,
    graph3d: container.querySelector("#graph3d") as HTMLDivElement,
    graph2d: container.querySelector("#graph2d") as HTMLDivElement,
    rendererBadge: container.querySelector("#rendererBadge") as HTMLDivElement,
    devBanner: container.querySelector("#devBanner") as HTMLDivElement
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
};

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
  return fetch(input, init);
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

function colorForType(type: string): string {
  if (type === "parent") return "#3b82f6";
  if (type === "depends") return "#ef4444";
  return "#6b7280";
}

function cursorStorageKey(principal: string, graphSpaceId: string): string {
  return `mesh.cursor.${principal}.${graphSpaceId}`;
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

function cursorEq(left: Cursor, right: Cursor): boolean {
  return left.metaSeq === right.metaSeq && left.graphSeq === right.graphSeq;
}

function emitMeshDebugLog(message: string, detail?: unknown): void {
  const target = (window as Window & { __meshDebug?: MeshDebugApi }).__meshDebug;
  target?.log?.(message, detail);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

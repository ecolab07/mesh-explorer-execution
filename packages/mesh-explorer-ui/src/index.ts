import ForceGraph3D from "3d-force-graph";
import ForceGraph2D from "force-graph";

type Cursor = { metaSeq: number; graphSeq: number };
type GraphNode = { id: string; label: string; level?: number; metadata?: Record<string, unknown> };
type GraphLink = { id: string; source: string; target: string; type: string; label?: string };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type GraphFrame = { kind?: string; cursorVisible?: number; txBundle?: { graphEvents: unknown[] } };

type GraphEvent =
  | { type: "graph.node.created"; node: GraphNode }
  | { type: "graph.node.label.updated"; nodeId: string; label: string }
  | { type: "graph.node.deleted"; nodeId: string }
  | { type: "graph.link.created"; link: GraphLink }
  | { type: "graph.link.deleted"; linkId: string };

export function mountMeshExplorerUi(container: HTMLElement): void {
  container.innerHTML = `
    <section style="display:grid;grid-template-columns:320px 1fr;gap:12px;height:100vh;font-family:sans-serif;">
      <aside style="padding:12px;border-right:1px solid #ddd;overflow:auto;">
        <h3>Mesh Explorer</h3>
        <label>baseUrl <input id="baseUrl" style="width:100%" value="http://127.0.0.1:8090"/></label><br/>
        <label>graphSpaceId <input id="graphSpaceId" style="width:100%" value="mesh-explorer-graph-v1"/></label><br/>
        <label>principal <input id="principal" style="width:100%" value="alice"/></label><br/>
        <button id="connect">Connect</button>
        <hr/>
        <div id="status">disconnected</div>
        <div id="lastCursor">cursor: n/a</div>
        <div id="lastSync">last sync: n/a</div>
        <hr/>
        <button id="addNode">Add node</button>
        <button id="addLink">Add link</button>
      </aside>
      <main style="display:grid;grid-template-rows:1fr 320px;gap:8px;padding:8px;">
        <div id="graph3d" style="border:1px solid #ddd;"></div>
        <div id="graph2d" style="border:1px solid #ddd;"></div>
      </main>
    </section>
  `;

  const el = byId(container);
  const state = {
    nodes: new Map<string, GraphNode>(),
    links: new Map<string, GraphLink>(),
    cursor: { metaSeq: 0, graphSeq: 0 } as Cursor,
    stop: false
  };

  const graph3d = ForceGraph3D()(el.graph3d)
    .nodeId("id")
    .nodeLabel((node: unknown) => (node as GraphNode).label)
    .linkLabel((link: unknown) => `${(link as GraphLink).type}`)
    .linkColor((link: unknown) => colorForType((link as GraphLink).type));

  const graph2d = ForceGraph2D()(el.graph2d)
    .nodeId("id")
    .nodeLabel("label")
    .linkColor((link: unknown) => colorForType((link as GraphLink).type));

  el.connect.onclick = () => {
    state.stop = true;
    state.stop = false;
    void connectAndSync();
  };

  el.addNode.onclick = () => {
    const label = prompt("Node label", "new node") ?? "";
    if (!label) return;
    void fetch(`${el.baseUrl.value}/graph/nodes`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({ label, idempotencyKey: crypto.randomUUID() })
    });
  };

  el.addLink.onclick = () => {
    const source = prompt("Source node id") ?? "";
    const target = prompt("Target node id") ?? "";
    const type = prompt("Link type", "related") ?? "related";
    if (!source || !target) return;
    void fetch(`${el.baseUrl.value}/graph/links`, {
      method: "POST",
      headers: headers(el.principal.value),
      body: JSON.stringify({ source, target, type, idempotencyKey: crypto.randomUUID() })
    });
  };

  void connectAndSync();

  async function connectAndSync(): Promise<void> {
    const storageKey = cursorStorageKey(el.baseUrl.value, el.graphSpaceId.value, el.principal.value);
    const savedCursor = readCursor(storageKey);
    state.cursor = savedCursor ?? { metaSeq: 0, graphSeq: 0 };
    el.status.textContent = "connected";
    await pollFromCursor();
    void subscribeLoop();

    async function subscribeLoop(): Promise<void> {
      while (!state.stop) {
        try {
          const url = `${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:subscribe?from=${state.cursor.graphSeq}`;
          const response = await fetch(url, { headers: { "x-mesh-principal": el.principal.value } });
          if (!response.body) {
            await wait(300);
            continue;
          }
          for await (const frame of parseSse(response.body)) {
            const data = frame as GraphFrame;
            if (state.stop) return;
            if (data.kind === "tx" && data.txBundle) {
              applyTx(data.txBundle.graphEvents as GraphEvent[]);
            }
            if (data.kind === "cursor" && typeof data.cursorVisible === "number") {
              state.cursor.graphSeq = data.cursorVisible;
              persistCursor(storageKey, state.cursor);
              renderStatus();
            }
          }
        } catch {
          await wait(500);
        }
      }
    }

    async function pollFromCursor(): Promise<void> {
      const limits = encodeURIComponent(JSON.stringify({ graph: 128, meta: 32 }));
      const cursor = encodeURIComponent(JSON.stringify(state.cursor));
      const response = await fetch(
        `${el.baseUrl.value}/v1/${encodeURIComponent(el.graphSpaceId.value)}/sync:poll?cursor=${cursor}&limits=${limits}`,
        { headers: { "x-mesh-principal": el.principal.value } }
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { graph?: GraphEvent[]; cursorAfter?: Cursor };
      applyTx(payload.graph ?? []);
      state.cursor = payload.cursorAfter ?? state.cursor;
      persistCursor(storageKey, state.cursor);
      renderStatus();
    }
  }

  function applyTx(events: GraphEvent[]): void {
    for (const event of events) {
      if (event.type === "graph.node.created") state.nodes.set(event.node.id, event.node);
      if (event.type === "graph.node.label.updated") {
        const node = state.nodes.get(event.nodeId);
        if (node) state.nodes.set(event.nodeId, { ...node, label: event.label });
      }
      if (event.type === "graph.node.deleted") {
        state.nodes.delete(event.nodeId);
        for (const [id, link] of state.links) {
          if (link.source === event.nodeId || link.target === event.nodeId) state.links.delete(id);
        }
      }
      if (event.type === "graph.link.created") state.links.set(event.link.id, event.link);
      if (event.type === "graph.link.deleted") state.links.delete(event.linkId);
    }
    const data: GraphData = {
      nodes: Array.from(state.nodes.values()),
      links: Array.from(state.links.values()).filter((link) => state.nodes.has(link.source) && state.nodes.has(link.target))
    };
    graph3d.graphData(data);
    graph2d.graphData(data);
    renderStatus();
  }

  function renderStatus(): void {
    el.lastCursor.textContent = `cursor: ${JSON.stringify(state.cursor)}`;
    el.lastSync.textContent = `last sync: ${new Date().toISOString()}`;
  }
}

type UiElements = {
  baseUrl: HTMLInputElement;
  graphSpaceId: HTMLInputElement;
  principal: HTMLInputElement;
  connect: HTMLButtonElement;
  addNode: HTMLButtonElement;
  addLink: HTMLButtonElement;
  status: HTMLDivElement;
  lastCursor: HTMLDivElement;
  lastSync: HTMLDivElement;
  graph3d: HTMLDivElement;
  graph2d: HTMLDivElement;
};

function byId(container: HTMLElement): UiElements {
  return {
    baseUrl: container.querySelector("#baseUrl") as HTMLInputElement,
    graphSpaceId: container.querySelector("#graphSpaceId") as HTMLInputElement,
    principal: container.querySelector("#principal") as HTMLInputElement,
    connect: container.querySelector("#connect") as HTMLButtonElement,
    addNode: container.querySelector("#addNode") as HTMLButtonElement,
    addLink: container.querySelector("#addLink") as HTMLButtonElement,
    status: container.querySelector("#status") as HTMLDivElement,
    lastCursor: container.querySelector("#lastCursor") as HTMLDivElement,
    lastSync: container.querySelector("#lastSync") as HTMLDivElement,
    graph3d: container.querySelector("#graph3d") as HTMLDivElement,
    graph2d: container.querySelector("#graph2d") as HTMLDivElement
  };
}

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

function colorForType(type: string): string {
  if (type === "parent") return "#3b82f6";
  if (type === "depends") return "#ef4444";
  return "#6b7280";
}

function cursorStorageKey(baseUrl: string, graphSpaceId: string, principal: string): string {
  return `mesh-explorer-cursor:${baseUrl}:${graphSpaceId}:${principal}`;
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
  localStorage.setItem(storageKey, JSON.stringify(cursor));
}

async function *parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<{ kind?: string; cursorVisible?: number; txBundle?: { graphEvents: unknown[] } }> {
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
      yield JSON.parse(data) as { kind?: string; cursorVisible?: number; txBundle?: { graphEvents: unknown[] } };
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

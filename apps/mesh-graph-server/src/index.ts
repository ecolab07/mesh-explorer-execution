import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileBackedLocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { SyncHttpReferenceServer } from "@mesh/sync-http";
import type { Command, CommandOutcome, Cursor, PrincipalContext } from "@mesh/shared";

const GRAPH_SPACE_ID = "mesh-explorer-graph-v1";
const PRINCIPAL_HEADER = "x-mesh-principal";
const STORE_CACHE = new Map<string, FileBackedLocalEventStore>();

type GraphNode = { id: string; label: string; level?: number; metadata?: Record<string, unknown> };
type GraphLink = { id: string; source: string; target: string; type: string; label?: string };
type GraphView = { nodes: GraphNode[]; links: GraphLink[] };

type GraphEvent =
  | { type: "graph.node.created"; node: GraphNode; _acl?: Record<string, "mask"> }
  | { type: "graph.node.label.updated"; nodeId: string; label: string; _acl?: Record<string, "mask"> }
  | { type: "graph.node.deleted"; nodeId: string; _acl?: Record<string, "mask"> }
  | { type: "graph.link.created"; link: GraphLink; _acl?: Record<string, "mask"> }
  | { type: "graph.link.deleted"; linkId: string; _acl?: Record<string, "mask"> };

type LocalSyncGatewayLike = {
  submit(graphSpaceId: string, principal: PrincipalContext, command: Command, idempotencyKey?: string): {
    ackTransport: { accepted: true; idempotencyKey: string };
    final: Promise<CommandOutcome>;
  };
  syncPull(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitTx?: number; limitBytes?: number }
  ): Promise<{ txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }>; cursorAfterVisible: number }>;
  syncSubscribe(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitTx?: number; limitBytes?: number; heartbeatEveryMs?: number; pollIntervalMs?: number }
  ): AsyncIterable<unknown>;
  eventsRead(
    graphSpaceId: string,
    principal: PrincipalContext,
    stream: "meta" | "graph",
    fromSeqExclusive: number,
    options?: { limitEvents?: number; limitBytes?: number }
  ): Promise<unknown[]>;
  syncPoll(
    graphSpaceId: string,
    principal: PrincipalContext,
    cursor: Cursor,
    options?: {
      metaLimitEvents?: number;
      metaLimitBytes?: number;
      graphLimitEvents?: number;
      graphLimitBytes?: number;
    }
  ): Promise<{ meta: unknown[]; graph: unknown[]; cursorAfter: Cursor }>;
};

type LocalSyncGatewayCtor = new (
  store: FileBackedLocalEventStore,
  config: { graphSpaceId: string; executeCommand: (command: Command) => Promise<CommandOutcome> }
) => LocalSyncGatewayLike;

async function loadLocalSyncGatewayCtor(): Promise<LocalSyncGatewayCtor> {
  const gatewayModuleHref = pathToFileURL(join(process.cwd(), "packages/sync-local/src/internal/transportGateway.ts")).href;
  const loaded = (await import(gatewayModuleHref)) as { LocalSyncGateway: LocalSyncGatewayCtor };
  return loaded.LocalSyncGateway;
}

export interface MeshGraphServerOptions {
  storageDir: string;
  graphSpaceId?: string;
  host?: string;
  port?: number;
}

export interface MeshGraphServerHandle {
  url: string;
  port: number;
  syncUrl: string;
  graphSpaceId: string;
  close: () => Promise<void>;
}

export async function startMeshGraphServer(options: MeshGraphServerOptions): Promise<MeshGraphServerHandle> {
  await fs.mkdir(options.storageDir, { recursive: true });
  const graphSpaceId = options.graphSpaceId ?? GRAPH_SPACE_ID;
  process.env.MESH_TX_VISIBILITY_POLICY = "acl";

  const storePath = join(options.storageDir, "graph-eventstore.json");
  const store = STORE_CACHE.get(storePath) ?? new FileBackedLocalEventStore(storePath);
  STORE_CACHE.set(storePath, store);
  const kernel = new KernelMinimalImpl(store);
  const Gateway = await loadLocalSyncGatewayCtor();
  const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
  const syncServer = new SyncHttpReferenceServer({ graphSpaceId, gateway });
  const syncListen = await syncServer.listen(0, "127.0.0.1");

  const appServer = createServer((req, res) => {
    void handleRequest(req, res, { gateway, graphSpaceId, syncBaseUrl: syncListen.url });
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8090;
  appServer.listen(port, host);
  await once(appServer, "listening");
  const address = appServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to bind mesh graph server");
  }

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    syncUrl: syncListen.url,
    graphSpaceId,
    close: async () => {
      if (appServer.listening) {
        appServer.close();
        await once(appServer, "close");
      }
      await syncServer.close();
    }
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { gateway: LocalSyncGatewayLike; graphSpaceId: string; syncBaseUrl: string }
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", "http://graph.local");
  const principal = parsePrincipal(req);
  if (!principal) {
    writeJson(res, 401, { status: "rejected", category: "PERMISSION", reasonCode: "AUTH.PRINCIPAL_REQUIRED" });
    return;
  }

  if (requestUrl.pathname.startsWith("/v1/")) {
    await proxyToSyncServer(req, res, `${deps.syncBaseUrl}${requestUrl.pathname}${requestUrl.search}`);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/graph/view") {
    writeJson(res, 200, await readGraphView(deps.gateway, deps.graphSpaceId, principal));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/graph/nodes") {
    const body = (await readJsonBody(req)) as Partial<GraphNode> & { idempotencyKey?: string };
    const node: GraphNode = {
      id: typeof body.id === "string" && body.id.trim() ? body.id : randomUUID(),
      label: typeof body.label === "string" ? body.label : "",
      level: typeof body.level === "number" ? body.level : undefined,
      metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata as Record<string, unknown> : undefined
    };
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey : randomUUID();
    const outcome = await submitGraphCommand(deps.gateway, deps.graphSpaceId, principal, idempotencyKey, {
      type: "graph.node.created",
      node
    });
    writeJson(res, 200, { node, outcome });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/graph/links") {
    const body = (await readJsonBody(req)) as Partial<GraphLink> & { idempotencyKey?: string };
    if (typeof body.source !== "string" || typeof body.target !== "string") {
      writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "TRANSPORT.INVALID_REQUEST" });
      return;
    }
    const link: GraphLink = {
      id: typeof body.id === "string" && body.id.trim() ? body.id : randomUUID(),
      source: body.source,
      target: body.target,
      type: typeof body.type === "string" && body.type.trim() ? body.type : "related",
      label: typeof body.label === "string" ? body.label : undefined
    };
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey : randomUUID();
    const outcome = await submitGraphCommand(deps.gateway, deps.graphSpaceId, principal, idempotencyKey, {
      type: "graph.link.created",
      link
    });
    writeJson(res, 200, { link, outcome });
    return;
  }

  writeJson(res, 404, { status: "error", category: "NOT_FOUND", reasonCode: "NOT_FOUND.GENERIC" });
}

async function submitGraphCommand(
  gateway: LocalSyncGatewayLike,
  graphSpaceId: string,
  principal: PrincipalContext,
  idempotencyKey: string,
  payload: GraphEvent
): Promise<CommandOutcome> {
  const command: Command = {
    graphSpaceId,
    commandId: randomUUID(),
    actorId: principal.principalId,
    idempotencyKey,
    payload: {
      ...payload,
      _acl: maskForOtherPrincipal(principal.principalId)
    }
  };
  const submitted = gateway.submit(graphSpaceId, principal, command, idempotencyKey);
  return submitted.final;
}

async function readGraphView(gateway: LocalSyncGatewayLike, graphSpaceId: string, principal: PrincipalContext): Promise<GraphView> {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();
  let cursor = 0;
  while (true) {
    const pulled = await gateway.syncPull(graphSpaceId, principal, cursor, { limitTx: 64, limitBytes: 128 * 1024 });
    for (const bundle of pulled.txBundlesVisible) {
      for (const rawEvent of bundle.txBundle.graphEvents) {
        applyGraphEvent(nodes, links, rawEvent as GraphEvent);
      }
    }
    if (pulled.cursorAfterVisible === cursor) {
      break;
    }
    cursor = pulled.cursorAfterVisible;
  }
  return {
    nodes: Array.from(nodes.values()),
    links: Array.from(links.values()).filter((link) => nodes.has(link.source) && nodes.has(link.target))
  };
}

function applyGraphEvent(nodes: Map<string, GraphNode>, links: Map<string, GraphLink>, event: GraphEvent): void {
  if (event.type === "graph.node.created") {
    nodes.set(event.node.id, event.node);
    return;
  }
  if (event.type === "graph.node.label.updated") {
    const existing = nodes.get(event.nodeId);
    if (!existing) return;
    nodes.set(event.nodeId, { ...existing, label: event.label });
    return;
  }
  if (event.type === "graph.node.deleted") {
    nodes.delete(event.nodeId);
    for (const [id, link] of links) {
      if (link.source === event.nodeId || link.target === event.nodeId) links.delete(id);
    }
    return;
  }
  if (event.type === "graph.link.created") {
    links.set(event.link.id, event.link);
    return;
  }
  if (event.type === "graph.link.deleted") {
    links.delete(event.linkId);
  }
}

function parsePrincipal(req: IncomingMessage): PrincipalContext | null {
  const raw = req.headers[PRINCIPAL_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { principalId: trimmed };
}

function maskForOtherPrincipal(principal: string): Record<string, "mask"> {
  if (principal === "alice") return { bob: "mask" };
  if (principal === "bob") return { alice: "mask" };
  return {};
}

async function proxyToSyncServer(req: IncomingMessage, res: ServerResponse, targetUrl: string): Promise<void> {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRawBody(req);
  const proxied = await fetch(targetUrl, {
    method: req.method,
    headers: copyHeaders(req.headers),
    body
  });

  res.statusCode = proxied.status;
  for (const [header, value] of proxied.headers.entries()) {
    res.setHeader(header, value);
  }

  if (!proxied.body) {
    res.end();
    return;
  }

  const reader = proxied.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (!res.write(Buffer.from(value))) {
      await once(res, "drain");
    }
  }
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) {
    raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return raw;
}

function copyHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key] = value;
    if (Array.isArray(value)) out[key] = value.join(",");
  }
  return out;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const storageDir = process.env.MESH_GRAPH_STORAGE_DIR ?? ".mesh-graph-data";
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8090;
  startMeshGraphServer({ storageDir, port }).then((server) => {
    process.stdout.write(`mesh-graph-server listening on ${server.url} (graphSpaceId=${server.graphSpaceId})\n`);
  });
}

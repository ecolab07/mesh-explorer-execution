import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { FileBackedLocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { LocalSyncGateway } from "@mesh/sync-local/internal";
import type { Command, CommandOutcome, Cursor, PrincipalContext } from "@mesh/shared";

const GRAPH_SPACE_ID = "00000000-0000-4000-8000-000000000001";
const UUID_V4ISH_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINCIPAL_HEADER = "x-mesh-principal";
const IDEMPOTENCY_HEADER = "x-idempotency-key";
const DEBUG_TOKEN_HEADER = "x-mesh-debug-token";
const DEBUG_AUTH_ENABLED = process.env.MESH_DEBUG_AUTH === "1";
const RETENTION_JOB_ENABLED = process.env.MESH_RETENTION_JOB_ENABLED !== "0";
const RETENTION_JOB_INTERVAL_MS = Number(process.env.MESH_RETENTION_JOB_INTERVAL_MS ?? (process.env.NODE_ENV === "production" ? 60 * 60_000 : 5 * 60_000));

const DEV_RETENTION_PRESET: RetentionPolicy = {
  ttlSeconds: 86_400,
  maxEvents: 20_000,
  snapshotEveryNEvents: 500,
  snapshotEverySeconds: 300,
  minSnapshotsToKeep: 3,
  mode: "delete"
};

const PROD_RETENTION_PRESET: RetentionPolicy = {
  ttlSeconds: 2_592_000,
  maxEvents: 1_000_000,
  snapshotEveryNEvents: 10_000,
  snapshotEverySeconds: 86_400,
  minSnapshotsToKeep: 30,
  mode: "archive"
};

type GraphNode = { id: string; label: string; level?: number; metadata?: Record<string, unknown> };
type GraphLink = { id: string; source: string; target: string; type: string; label?: string };
type GraphView = { nodes: GraphNode[]; links: GraphLink[] };
type SnapshotPayload = { nodes: GraphNode[]; links: GraphLink[]; version: 1 };

type GraphEvent =
  | { type: "graph.node.created"; node: GraphNode; _acl?: Record<string, "mask"> }
  | { type: "graph.node.label.updated"; nodeId: string; label: string; _acl?: Record<string, "mask"> }
  | { type: "graph.node.deleted"; nodeId: string; _acl?: Record<string, "mask"> }
  | { type: "graph.link.created"; link: GraphLink; _acl?: Record<string, "mask"> }
  | { type: "graph.link.deleted"; linkId: string; _acl?: Record<string, "mask"> };

interface RetentionPolicy {
  ttlSeconds?: number;
  maxEvents?: number;
  snapshotEveryNEvents: number;
  snapshotEverySeconds: number;
  minSnapshotsToKeep: number;
  mode: "archive" | "delete";
}

type ProjectRecord = {
  id: string;
  // v1 invariant: projectId and graphSpaceId are the same UUID.
  name: string;
  createdAt: number;
  updatedAt: number;
  headCursor: Cursor;
  minReadableCursor: Cursor;
  retentionPolicy: RetentionPolicy;
};

type SnapshotRecord = {
  snapshotId: string;
  projectId: string;
  graphSpaceId: string;
  cursor: Cursor;
  createdAt: number;
  label?: string;
  sizeBytes?: number;
  nodeCount?: number;
  linkCount?: number;
  payload: SnapshotPayload;
};

type CatalogState = {
  projects: Record<string, ProjectRecord>;
  snapshots: Record<string, SnapshotRecord[]>;
  metadata?: {
    legacyProjectMigration?: LegacyProjectMigrationSummary;
  };
};

type LegacyProjectMigrationMapping = {
  oldId: string;
  newId: string;
  derivedName: string;
};

type LegacyProjectMigrationSummary = {
  pendingNotice: boolean;
  migratedCount: number;
  mappings: LegacyProjectMigrationMapping[];
  appliedAt: number;
};

export type LegacyProjectMigrationResult = {
  migratedCount: number;
  mappings: LegacyProjectMigrationMapping[];
};

type LocalSyncGatewayLike = {
  submit(graphSpaceId: string, principal: PrincipalContext, command: Command, idempotencyKey?: string): {
    final: Promise<CommandOutcome>;
  };
  syncPull(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitTx?: number; limitBytes?: number }
  ): Promise<{ txBundlesVisible: Array<{ principalCursor: number; txBundle: { graphEvents: unknown[]; metaEvents?: unknown[] } }>; cursorAfterVisible: number }>;
  eventsRead(
    graphSpaceId: string,
    principal: PrincipalContext,
    stream: "meta" | "graph",
    fromSeqExclusive: number,
    options?: { limitEvents?: number; limitBytes?: number }
  ): Promise<Array<{ payload: unknown }>>;
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

type AdvanceMinReadableRequest = {
  projectId?: unknown;
  graphSpaceId?: unknown;
  newMinReadableCursor?: unknown;
  dryRun?: unknown;
};

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

function graphSpaceIdFromProjectId(projectId: string): string {
  // v1 constraint: 1 project == 1 graph space.
  return projectId;
}

function assertV1ProjectGraphInvariant(projectId: string, graphSpaceId: string): void {
  if (projectId !== graphSpaceId) {
    throw new Error(`v1 invariant violated: projectId (${projectId}) must equal graphSpaceId (${graphSpaceId})`);
  }
}

function isUuid(value: string): boolean {
  return UUID_V4ISH_REGEX.test(value);
}

export async function startMeshGraphServer(options: MeshGraphServerOptions): Promise<MeshGraphServerHandle> {
  await fs.mkdir(options.storageDir, { recursive: true });
  const preferredProjectId = options.graphSpaceId ?? GRAPH_SPACE_ID;
  const graphSpaceId = isUuid(preferredProjectId) ? preferredProjectId : randomUUID();
  if (!isUuid(preferredProjectId)) console.info(`[mesh-graph-server] migrated legacy configured graphSpaceId (${preferredProjectId}) to UUID project id (${graphSpaceId}).`);
  process.env.MESH_TX_VISIBILITY_POLICY = "acl";

  const projectStores = new Map<string, { store: FileBackedLocalEventStore; gateway: LocalSyncGatewayLike; kernel: KernelMinimalImpl }>();
  const catalogPath = join(options.storageDir, "mesh-projects.json");
  const { catalog, writeApplied } = await loadCatalog(catalogPath);
  let shouldPersistCatalog = writeApplied;
  const migration = catalog.metadata?.legacyProjectMigration;
  if (migration?.pendingNotice) {
    console.info("[mesh-graph-server] migrated legacy projects", {
      migratedCount: migration.migratedCount,
      mappings: migration.mappings
    });
    migration.pendingNotice = false;
    shouldPersistCatalog = true;
  }
  if (shouldPersistCatalog) {
    await saveCatalog(catalogPath, catalog);
  }

  async function getProjectContext(projectId: string): Promise<{ store: FileBackedLocalEventStore; gateway: LocalSyncGatewayLike; kernel: KernelMinimalImpl }> {
    const cached = projectStores.get(projectId);
    if (cached) return cached;
    const storePath = join(options.storageDir, `graph-eventstore-${projectId}.json`);
    const store = new FileBackedLocalEventStore(storePath);
    const kernel = new KernelMinimalImpl(store);
    const graphSpaceId = graphSpaceIdFromProjectId(projectId);
    assertV1ProjectGraphInvariant(projectId, graphSpaceId);
    const gateway = new LocalSyncGateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const loaded = { store, gateway, kernel };
    projectStores.set(projectId, loaded);
    return loaded;
  }

  async function ensureProject(projectId: string, name?: string): Promise<ProjectRecord> {
    if (!isUuid(projectId)) throw new Error(`projectId must be a UUID: ${projectId}`);
    const existing = catalog.projects[projectId];
    if (existing) {
      if (typeof name === "string" && name.trim() && name !== existing.name) {
        existing.name = name.trim();
        existing.updatedAt = Date.now();
        await saveCatalog(catalogPath, catalog);
      }
      return existing;
    }
    const now = Date.now();
    const policy = process.env.NODE_ENV === "production" ? PROD_RETENTION_PRESET : DEV_RETENTION_PRESET;
    const record: ProjectRecord = {
      id: projectId,
      name: typeof name === "string" && name.trim() ? name.trim() : "Untitled project",
      createdAt: now,
      updatedAt: now,
      headCursor: { metaSeq: 0, graphSeq: 0 },
      minReadableCursor: { metaSeq: 0, graphSeq: 0 },
      retentionPolicy: { ...policy }
    };
    catalog.projects[projectId] = record;
    catalog.snapshots[projectId] = [];
    await saveCatalog(catalogPath, catalog);
    await getProjectContext(projectId);
    return record;
  }

  async function refreshProjectHead(projectId: string): Promise<void> {
    const project = catalog.projects[projectId];
    if (!project) return;
    const context = await getProjectContext(projectId);
    project.headCursor = await context.store.getCursorHead(projectId);
    project.updatedAt = Date.now();
    await saveCatalog(catalogPath, catalog);
  }

  async function createSnapshot(projectId: string, label?: string): Promise<SnapshotRecord> {
    const project = await ensureProject(projectId);
    const context = await getProjectContext(projectId);
    const principal = { principalId: "system" };
    const snapshotBuild = await readGraphView(context.gateway, projectId, principal);
    const cursor = await context.store.getCursorHead(projectId);
    project.headCursor = cursor;
    const payload: SnapshotPayload = { nodes: snapshotBuild.view.nodes, links: snapshotBuild.view.links, version: 1 };
    const serialized = JSON.stringify(payload);
    const record: SnapshotRecord = {
      snapshotId: randomUUID(),
      projectId,
      graphSpaceId: graphSpaceIdFromProjectId(projectId),
      cursor,
      createdAt: Date.now(),
      label,
      sizeBytes: serialized.length,
      nodeCount: payload.nodes.length,
      linkCount: payload.links.length,
      payload
    };
    catalog.snapshots[projectId] = [record, ...(catalog.snapshots[projectId] ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    project.updatedAt = Date.now();
    console.info("AUTO_SNAPSHOT_CREATED", {
      snapshotId: record.snapshotId,
      head: record.cursor.graphSeq,
      projectId,
      graphSpaceId: graphSpaceIdFromProjectId(projectId),
      reason: label === "auto" ? "auto" : "manual"
    });
    console.info("SNAPSHOT_BUILD", {
      snapshotId: record.snapshotId,
      projectId,
      graphSpaceId: graphSpaceIdFromProjectId(projectId),
      reason: label === "auto" ? "auto" : "manual",
      buildStrategy: "replay",
      baseCursor: snapshotBuild.baseCursor,
      replayedEventsCount: snapshotBuild.replayedEventsCount,
      snapshotCursor: cursor,
      sizeBytes: record.sizeBytes,
      nodeCount: record.nodeCount,
      linkCount: record.linkCount
    });
    await saveCatalog(catalogPath, catalog);
    return record;
  }

  function latestSnapshotHead(projectId: string): number {
    const snapshots = catalog.snapshots[projectId] ?? [];
    return snapshots.length > 0 ? snapshots[0]!.cursor.graphSeq : 0;
  }

  async function maybeCreateAutoSnapshot(projectId: string): Promise<void> {
    const project = await ensureProject(projectId);
    await refreshProjectHead(projectId);
    const everyN = Math.max(1, project.retentionPolicy.snapshotEveryNEvents);
    const head = project.headCursor.graphSeq;
    const lastSnapshotHead = latestSnapshotHead(projectId);
    const shouldSnapshot = head > 0 && head - lastSnapshotHead >= everyN;
    console.info("AUTO_SNAPSHOT_CHECK", {
      projectId,
      graphSpaceId: graphSpaceIdFromProjectId(projectId),
      head,
      lastSnapshotHead,
      everyN,
      shouldSnapshot
    });
    if (shouldSnapshot) await createSnapshot(projectId, "auto");
  }

  async function purgeHistory(projectId: string, dryRun = false): Promise<Record<string, unknown>> {
    const project = await ensureProject(projectId);
    const snapshots = (catalog.snapshots[projectId] ?? []).sort((a, b) => b.createdAt - a.createdAt);
    const keepCount = Math.max(1, project.retentionPolicy.minSnapshotsToKeep);
    if (snapshots.length <= keepCount) {
      return { eventsPurgedCount: 0, snapshotsDeletedCount: 0, newMinReadableCursor: project.minReadableCursor, cutSnapshotId: null };
    }
    await refreshProjectHead(projectId);
    const head = project.headCursor;
    const now = Date.now();
    const protectedIds = new Set(snapshots.slice(0, keepCount).map((snapshot) => snapshot.snapshotId));
    const eligible = snapshots.filter((snapshot) => !protectedIds.has(snapshot.snapshotId));
    const ttlEligible = typeof project.retentionPolicy.ttlSeconds === "number"
      ? eligible.filter((snapshot) => now - snapshot.createdAt >= project.retentionPolicy.ttlSeconds! * 1000)
      : [];
    const maxEventsEligible = typeof project.retentionPolicy.maxEvents === "number"
      ? eligible.filter((snapshot) => head.graphSeq - snapshot.cursor.graphSeq >= project.retentionPolicy.maxEvents!)
      : [];
    const candidates = [...ttlEligible, ...maxEventsEligible];
    if (candidates.length === 0) {
      return { eventsPurgedCount: 0, snapshotsDeletedCount: 0, newMinReadableCursor: project.minReadableCursor, cutSnapshotId: null };
    }
    const cutSnapshot = candidates.sort((a, b) => b.cursor.graphSeq - a.cursor.graphSeq)[0]!;
    const toDelete = snapshots.filter((snapshot) => snapshot.createdAt < cutSnapshot.createdAt && !protectedIds.has(snapshot.snapshotId));
    const context = await getProjectContext(projectId);
    const beforeHead = await context.store.getCursorHead(projectId);
    if (!dryRun) {
      await context.store.compactUpToCursor({ graphSpaceId: graphSpaceIdFromProjectId(projectId), cursorExclusive: cutSnapshot.cursor.graphSeq });
      catalog.snapshots[projectId] = snapshots.filter((snapshot) => !toDelete.some((stale) => stale.snapshotId === snapshot.snapshotId));
      project.minReadableCursor = cutSnapshot.cursor;
      project.headCursor = await context.store.getCursorHead(projectId);
      project.updatedAt = Date.now();
      await saveCatalog(catalogPath, catalog);
    }
    return {
      eventsPurgedCount: Math.max(0, beforeHead.graphSeq - cutSnapshot.cursor.graphSeq),
      snapshotsDeletedCount: toDelete.length,
      newMinReadableCursor: cutSnapshot.cursor,
      cutSnapshotId: cutSnapshot.snapshotId,
      dryRun
    };
  }

  await ensureProject(graphSpaceId);
  if (RETENTION_JOB_ENABLED) {
    const timer = setInterval(() => {
      void runRetentionJob(catalog.projects, ensureProject, refreshProjectHead, createSnapshot, purgeHistory);
    }, RETENTION_JOB_INTERVAL_MS);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") (timer as unknown as { unref: () => void }).unref();
  }

  const appServer = createServer((req, res) => {
    void handleRequest(req, res, { graphSpaceId, catalog, catalogPath, ensureProject, getProjectContext, refreshProjectHead, createSnapshot, purgeHistory, maybeCreateAutoSnapshot });
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8090;
  appServer.listen(port, host);
  await once(appServer, "listening");
  const address = appServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind mesh graph server");

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    syncUrl: `http://${host}:${address.port}`,
    graphSpaceId,
    close: async () => {
      if (appServer.listening) {
        appServer.close();
        await once(appServer, "close");
      }
    }
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {
    graphSpaceId: string;
    catalog: CatalogState;
    catalogPath: string;
    ensureProject: (projectId: string, name?: string) => Promise<ProjectRecord>;
    getProjectContext: (projectId: string) => Promise<{ store: FileBackedLocalEventStore; gateway: LocalSyncGatewayLike; kernel: KernelMinimalImpl }>;
    refreshProjectHead: (projectId: string) => Promise<void>;
    createSnapshot: (projectId: string, label?: string) => Promise<SnapshotRecord>;
    purgeHistory: (projectId: string, dryRun?: boolean) => Promise<Record<string, unknown>>;
    maybeCreateAutoSnapshot: (projectId: string) => Promise<void>;
  }
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", "http://graph.local");
  applyCorsHeaders(res);
  if (req.method === "OPTIONS") return void (res.statusCode = 204, res.end());

  if (req.method === "GET" && requestUrl.pathname === "/") return void writePlainText(res, 200, buildRootHelpMessage(deps.graphSpaceId));

  if (req.method === "GET" && requestUrl.pathname === "/v1/projects") {
    const migration = deps.catalog.metadata?.legacyProjectMigration;
    if (migration && migration.migratedCount > 0) {
      res.setHeader("x-mesh-legacy-migration-count", String(migration.migratedCount));
      res.setHeader("x-mesh-legacy-migration-applied-at", String(migration.appliedAt));
      res.setHeader("x-mesh-legacy-migration-mappings", JSON.stringify(migration.mappings));
    }
    const entries = Object.values(deps.catalog.projects).map((project) => ({ ...project, projectId: project.id, graphSpaceId: graphSpaceIdFromProjectId(project.id), snapshotsCount: deps.catalog.snapshots[project.id]?.length ?? 0 }));
    writeJson(res, 200, entries);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/projects") {
    const body = (await readJsonBody(req)) as { name?: string };
    const projectId = randomUUID();
    const project = await deps.ensureProject(projectId, body.name);
    writeJson(res, 201, { id: project.id, projectId: project.id, name: project.name, graphSpaceId: graphSpaceIdFromProjectId(project.id) });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/debug/advance-min-readable-cursor") {
    if (!debugEndpointsEnabled()) {
      writeJson(res, 403, { status: "rejected", category: "PERMISSION", reasonCode: "DEBUG_ENDPOINTS.DISABLED" });
      return;
    }
    if (!hasValidDebugToken(req)) {
      writeJson(res, 403, { status: "rejected", category: "PERMISSION", reasonCode: "DEBUG_ENDPOINTS.INVALID_TOKEN" });
      return;
    }
    const body = (await readJsonBody(req)) as AdvanceMinReadableRequest;
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const graphSpaceId = typeof body.graphSpaceId === "string" ? body.graphSpaceId : "";
    if (!projectId || !graphSpaceId || !isUuid(projectId) || !isUuid(graphSpaceId)) {
      writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "PROJECT_SCOPE.INVALID" });
      return;
    }
    if (graphSpaceIdFromProjectId(projectId) !== graphSpaceId) {
      writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "PROJECT_SCOPE.MISMATCH" });
      return;
    }
    const project = deps.catalog.projects[projectId];
    if (!project) {
      writeJson(res, 404, { status: "error", category: "NOT_FOUND", reasonCode: "PROJECT.NOT_FOUND", projectId, graphSpaceId });
      return;
    }
    // minReadableCursor is the minimal readable *start* sequence (inclusive).
    // For sync:poll/sync:subscribe, callers provide the last applied cursor and read from +1.
    const nextCursor = parseCursorFromBody(body.newMinReadableCursor);
    if (!nextCursor) {
      writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "CURSOR.INVALID", projectId, graphSpaceId });
      return;
    }
    const dryRun = body.dryRun !== false;
    await deps.refreshProjectHead(projectId);
    if (compareCursor(nextCursor, project.headCursor) > 0) {
      writeJson(res, 400, {
        status: "rejected",
        category: "VALIDATION",
        reasonCode: "CURSOR.BEYOND_HEAD",
        projectId,
        graphSpaceId,
        headCursor: project.headCursor,
        proposedMinReadableCursor: nextCursor
      });
      return;
    }
    const previous = project.minReadableCursor;
    const advanced = compareCursor(nextCursor, previous) > 0;
    if (!dryRun && advanced) {
      project.minReadableCursor = nextCursor;
      project.updatedAt = Date.now();
      await saveCatalog(deps.catalogPath, deps.catalog);
    }
    const latestSnapshot = deps.catalog.snapshots[projectId]?.[0] ?? null;
    writeJson(res, 200, {
      projectId,
      graphSpaceId,
      dryRun,
      previousMinReadableCursor: previous,
      proposedMinReadableCursor: nextCursor,
      appliedMinReadableCursor: !dryRun && advanced ? project.minReadableCursor : previous,
      advanced,
      headCursor: project.headCursor,
      latestSnapshotCursor: latestSnapshot?.cursor ?? null,
      cutSnapshotId: latestSnapshot?.snapshotId ?? null
    });
    return;
  }



  const renameMatch = /^\/v1\/projects\/([^/]+)\/name$/.exec(requestUrl.pathname);
  if (req.method === "PATCH" && renameMatch) {
    const projectId = decodeURIComponent(renameMatch[1]!);
    const project = deps.catalog.projects[projectId];
    if (!project) return void writeJson(res, 404, { status: "error", reasonCode: "PROJECT.NOT_FOUND" });
    const body = (await readJsonBody(req)) as { name?: unknown };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return void writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "PROJECT.NAME_REQUIRED" });
    }
    project.name = body.name.trim();
    project.updatedAt = Date.now();
    await saveCatalog(deps.catalogPath, deps.catalog);
    writeJson(res, 200, { id: project.id, projectId: project.id, name: project.name, graphSpaceId: graphSpaceIdFromProjectId(project.id) });
    return;
  }

  const principal = parsePrincipal(req);
  if (!principal) return void writeJson(res, 401, { status: "rejected", category: "PERMISSION", reasonCode: "AUTH.PRINCIPAL_REQUIRED" });

  const projectMatch = /^\/v1\/([^/]+)$/.exec(requestUrl.pathname);
  if (req.method === "GET" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]!);
    await deps.ensureProject(projectId);
    await deps.refreshProjectHead(projectId);
    const project = deps.catalog.projects[projectId];
    writeJson(res, 200, {
      ...project,
      serverCursor: project.headCursor,
      projectId: project.id,
      graphSpaceId: graphSpaceIdFromProjectId(project.id),
      snapshotsCount: deps.catalog.snapshots[projectId]?.length ?? 0
    });
    return;
  }

  const retentionMatch = /^\/v1\/([^/]+)\/retention$/.exec(requestUrl.pathname);
  if (req.method === "PATCH" && retentionMatch) {
    const projectId = decodeURIComponent(retentionMatch[1]!);
    const project = await deps.ensureProject(projectId);
    const body = (await readJsonBody(req)) as Partial<RetentionPolicy>;
    project.retentionPolicy = normalizeRetentionPolicy({ ...project.retentionPolicy, ...body });
    project.updatedAt = Date.now();
    await saveCatalog(deps.catalogPath, deps.catalog);
    writeJson(res, 200, { retentionPolicy: project.retentionPolicy });
    return;
  }

  const projectId = readProjectIdFromRequest(requestUrl.pathname);
  if (!projectId) {
    writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "GRAPH_SPACE_ID.REQUIRED" });
    return;
  }
  if (!isUuid(projectId)) {
    writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "PROJECT_ID.UUID_REQUIRED" });
    return;
  }
  const graphSpaceId = graphSpaceIdFromProjectId(projectId);
  assertV1ProjectGraphInvariant(projectId, graphSpaceId);
  await deps.ensureProject(projectId);
  const { gateway } = await deps.getProjectContext(projectId);

  if (req.method === "GET" && requestUrl.pathname === `/v1/${encodeURIComponent(projectId)}/graph:view`) {
    writeJson(res, 200, (await readGraphView(gateway, graphSpaceId, principal)).view);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === `/v1/${encodeURIComponent(projectId)}/graph:snapshot`) {
    const latest = deps.catalog.snapshots[projectId]?.[0] ?? (await deps.createSnapshot(projectId, "bootstrap"));
    writeJson(res, 200, latest);
    return;
  }

  const snapshotsListMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/snapshots$`).exec(requestUrl.pathname);
  if (req.method === "GET" && snapshotsListMatch) {
    writeJson(res, 200, deps.catalog.snapshots[projectId] ?? []);
    return;
  }
  const snapshotCreateMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/snapshots:create$`).exec(requestUrl.pathname);
  if (req.method === "POST" && snapshotCreateMatch) {
    const body = (await readJsonBody(req)) as { label?: string };
    const snapshot = await deps.createSnapshot(projectId, body.label);
    writeJson(res, 200, { snapshotId: snapshot.snapshotId, cursor: snapshot.cursor });
    return;
  }
  const snapshotGetMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/snapshots/([^/:]+)$`).exec(requestUrl.pathname);
  if (req.method === "GET" && snapshotGetMatch) {
    const snapshot = (deps.catalog.snapshots[projectId] ?? []).find((entry) => entry.snapshotId === decodeURIComponent(snapshotGetMatch[1]!));
    if (!snapshot) return void writeJson(res, 404, { status: "error", reasonCode: "SNAPSHOT.NOT_FOUND" });
    writeJson(res, 200, snapshot);
    return;
  }
  const forkMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/snapshots/([^/:]+):fork$`).exec(requestUrl.pathname);
  if (req.method === "POST" && forkMatch) {
    const snapshotId = decodeURIComponent(forkMatch[1]!);
    const snapshot = (deps.catalog.snapshots[projectId] ?? []).find((entry) => entry.snapshotId === snapshotId);
    if (!snapshot) return void writeJson(res, 404, { status: "error", reasonCode: "SNAPSHOT.NOT_FOUND" });
    const body = (await readJsonBody(req)) as { name?: string };
    const newProjectId = randomUUID();
    await deps.ensureProject(newProjectId, body.name);
    const newContext = await deps.getProjectContext(newProjectId);
    for (const node of snapshot.payload.nodes) {
      await submitGraphCommand(newContext.gateway, newProjectId, principal, randomUUID(), { type: "graph.node.created", node });
    }
    for (const link of snapshot.payload.links) {
      await submitGraphCommand(newContext.gateway, newProjectId, principal, randomUUID(), { type: "graph.link.created", link });
    }
    await deps.refreshProjectHead(newProjectId);
    const forked = deps.catalog.projects[newProjectId]!;
    forked.headCursor = await newContext.store.getCursorHead(newProjectId);
    forked.minReadableCursor = boundedMinReadableCursor(snapshot.cursor, forked.headCursor);
    await saveCatalog(deps.catalogPath, deps.catalog);
    await deps.createSnapshot(newProjectId, `fork:${snapshot.snapshotId}`);
    writeJson(res, 200, { newProjectId, id: newProjectId, graphSpaceId: graphSpaceIdFromProjectId(newProjectId) });
    return;
  }

  const purgeMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/history:purge$`).exec(requestUrl.pathname);
  if (req.method === "POST" && purgeMatch) {
    const body = (await readJsonBody(req)) as { dryRun?: boolean };
    writeJson(res, 200, await deps.purgeHistory(projectId, Boolean(body.dryRun)));
    return;
  }

  const pullMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/sync:pull$`).exec(requestUrl.pathname);
  if (req.method === "GET" && pullMatch) {
    const from = Number.parseInt(requestUrl.searchParams.get("from") ?? "0", 10) || 0;
    const project = deps.catalog.projects[projectId]!;
    if (from < project.minReadableCursor.graphSeq) {
      const recommendedSnapshotId = deps.catalog.snapshots[projectId]?.[0]?.snapshotId;
      writeJson(res, 410, { kind: "cursor_too_old", minReadableCursor: project.minReadableCursor, recommendedSnapshotId });
      return;
    }
    const result = await gateway.syncPull(graphSpaceId, principal, from, {
      limitTx: Number.parseInt(requestUrl.searchParams.get("limitTx") ?? "64", 10) || 64,
      limitBytes: Number.parseInt(requestUrl.searchParams.get("limitBytes") ?? `${128 * 1024}`, 10) || 128 * 1024
    });
    writeJson(res, 200, result);
    return;
  }

  const pollMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/sync:poll$`).exec(requestUrl.pathname);
  if (req.method === "GET" && pollMatch) {
    const cursor = parseCursor(requestUrl.searchParams.get("cursor"));
    const project = deps.catalog.projects[projectId]!;
    if (isPollCursorTooOld(cursor, project.minReadableCursor)) {
      const recommendedSnapshotId = deps.catalog.snapshots[projectId]?.[0]?.snapshotId;
      writeJson(res, 410, { kind: "cursor_too_old", minReadableCursor: project.minReadableCursor, recommendedSnapshotId });
      return;
    }
    const result = await gateway.syncPoll(graphSpaceId, principal, cursor);
    writeJson(res, 200, result);
    return;
  }

  const subscribeMatch = new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/sync:subscribe$`).exec(requestUrl.pathname);
  if (req.method === "GET" && subscribeMatch) {
    const from = Number.parseInt(requestUrl.searchParams.get("from") ?? "0", 10) || 0;
    const project = deps.catalog.projects[projectId]!;
    if (isSubscribeFromTooOld(from, project.minReadableCursor.graphSeq)) {
      const recommendedSnapshotId = deps.catalog.snapshots[projectId]?.[0]?.snapshotId;
      writeJson(res, 410, { kind: "cursor_too_old", minReadableCursor: project.minReadableCursor, recommendedSnapshotId });
      return;
    }
    await streamSubscribe(res, async (cursor) => gateway.syncPull(graphSpaceId, principal, cursor), from);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === `/v1/${encodeURIComponent(projectId)}/graph:nodes`) {
    const body = (await readJsonBody(req)) as Partial<GraphNode> & { idempotencyKey?: string };
    const node: GraphNode = {
      id: typeof body.id === "string" && body.id.trim() ? body.id : randomUUID(),
      label: typeof body.label === "string" ? body.label : "",
      level: typeof body.level === "number" ? body.level : undefined,
      metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata as Record<string, unknown> : undefined
    };
    const idempotencyKey = readIdempotencyKey(req, body.idempotencyKey);
    const outcome = await submitGraphCommand(gateway, graphSpaceId, principal, idempotencyKey, { type: "graph.node.created", node });
    await deps.maybeCreateAutoSnapshot(projectId);
    writeJson(res, 200, { node, outcome });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === `/v1/${encodeURIComponent(projectId)}/graph:links`) {
    const body = (await readJsonBody(req)) as Partial<GraphLink> & { idempotencyKey?: string };
    if (typeof body.source !== "string" || typeof body.target !== "string") return void writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "TRANSPORT.INVALID_REQUEST" });
    const link: GraphLink = {
      id: typeof body.id === "string" && body.id.trim() ? body.id : randomUUID(),
      source: body.source,
      target: body.target,
      type: typeof body.type === "string" && body.type.trim() ? body.type : "related",
      label: typeof body.label === "string" ? body.label : undefined
    };
    const idempotencyKey = readIdempotencyKey(req, body.idempotencyKey);
    const outcome = await submitGraphCommand(gateway, graphSpaceId, principal, idempotencyKey, { type: "graph.link.created", link });
    await deps.maybeCreateAutoSnapshot(projectId);
    writeJson(res, 200, { link, outcome });
    return;
  }

  if (req.method === "PATCH" && new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/graph:nodes/[^/]+$`).test(requestUrl.pathname)) {
    const body = (await readJsonBody(req)) as { label?: unknown; idempotencyKey?: string };
    if (typeof body.label !== "string") return void writeJson(res, 400, { status: "rejected", category: "VALIDATION", reasonCode: "TRANSPORT.INVALID_REQUEST" });
    const nodeId = decodeURIComponent(requestUrl.pathname.slice(`/v1/${encodeURIComponent(projectId)}/graph:nodes/`.length));
    const outcome = await submitGraphCommand(gateway, graphSpaceId, principal, readIdempotencyKey(req, body.idempotencyKey), { type: "graph.node.label.updated", nodeId, label: body.label });
    await deps.maybeCreateAutoSnapshot(projectId);
    writeJson(res, 200, { outcome, nodeId, label: body.label });
    return;
  }

  if (req.method === "DELETE" && new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/graph:links/[^/]+$`).test(requestUrl.pathname)) {
    const linkId = decodeURIComponent(requestUrl.pathname.slice(`/v1/${encodeURIComponent(projectId)}/graph:links/`.length));
    const outcome = await submitGraphCommand(gateway, graphSpaceId, principal, readIdempotencyKey(req), { type: "graph.link.deleted", linkId });
    await deps.maybeCreateAutoSnapshot(projectId);
    writeJson(res, 200, { outcome, linkId });
    return;
  }

  if (req.method === "DELETE" && new RegExp(`^/v1/${escapeRegExp(encodeURIComponent(projectId))}/graph:nodes/[^/]+$`).test(requestUrl.pathname)) {
    const nodeId = decodeURIComponent(requestUrl.pathname.slice(`/v1/${encodeURIComponent(projectId)}/graph:nodes/`.length));
    const outcome = await submitGraphCommand(gateway, graphSpaceId, principal, readIdempotencyKey(req), { type: "graph.node.deleted", nodeId });
    await deps.maybeCreateAutoSnapshot(projectId);
    writeJson(res, 200, { outcome, nodeId });
    return;
  }

  writeJson(res, 404, { status: "error", category: "NOT_FOUND", reasonCode: "NOT_FOUND.GENERIC" });
}

function normalizeRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  return {
    ttlSeconds: typeof policy.ttlSeconds === "number" && policy.ttlSeconds > 0 ? Math.floor(policy.ttlSeconds) : undefined,
    maxEvents: typeof policy.maxEvents === "number" && policy.maxEvents > 0 ? Math.floor(policy.maxEvents) : undefined,
    snapshotEveryNEvents: Math.max(1, Math.floor(policy.snapshotEveryNEvents || 1)),
    snapshotEverySeconds: Math.max(1, Math.floor(policy.snapshotEverySeconds || 1)),
    minSnapshotsToKeep: Math.max(1, Math.floor(policy.minSnapshotsToKeep || 1)),
    mode: policy.mode === "archive" ? "archive" : "delete"
  };
}

export function migrateLegacyCatalog(raw: {
  projects?: Record<string, Partial<ProjectRecord> & { projectId?: string; id?: string; name?: string }>;
  snapshots?: Record<string, SnapshotRecord[]>;
  metadata?: CatalogState["metadata"];
}): { catalog: CatalogState; migration: LegacyProjectMigrationResult; migrationApplied: boolean } {
  const normalizedProjects: Record<string, ProjectRecord> = {};
  const normalizedSnapshots: Record<string, SnapshotRecord[]> = {};
  const mappings: LegacyProjectMigrationMapping[] = [];

  for (const [legacyKey, legacyProject] of Object.entries(raw.projects ?? {})) {
    const legacyId = typeof legacyProject.projectId === "string"
      ? legacyProject.projectId
      : typeof legacyProject.id === "string"
        ? legacyProject.id
        : legacyKey;
    const nextId = isUuid(legacyId) ? legacyId : randomUUID();
    const now = Date.now();
    const name = typeof legacyProject.name === "string" && legacyProject.name.trim()
      ? legacyProject.name.trim()
      : isUuid(legacyId)
        ? `Project ${legacyId.slice(0, 8)}`
        : legacyId;
    normalizedProjects[nextId] = {
      id: nextId,
      name,
      createdAt: typeof legacyProject.createdAt === "number" ? legacyProject.createdAt : now,
      updatedAt: typeof legacyProject.updatedAt === "number" ? legacyProject.updatedAt : now,
      headCursor: legacyProject.headCursor ?? { metaSeq: 0, graphSeq: 0 },
      minReadableCursor: legacyProject.minReadableCursor ?? { metaSeq: 0, graphSeq: 0 },
      retentionPolicy: normalizeRetentionPolicy((legacyProject.retentionPolicy as RetentionPolicy | undefined) ?? DEV_RETENTION_PRESET)
    };
    const legacySnapshots = [...(raw.snapshots?.[legacyKey] ?? []), ...(legacyId !== legacyKey ? (raw.snapshots?.[legacyId] ?? []) : [])];
    normalizedSnapshots[nextId] = legacySnapshots.map((snapshot) => ({
      ...snapshot,
      projectId: nextId,
      graphSpaceId: graphSpaceIdFromProjectId(nextId)
    }));
    if (legacyId !== nextId || legacyProject.projectId !== undefined || legacyProject.id !== nextId) {
      mappings.push({ oldId: legacyId, newId: nextId, derivedName: name });
    }
  }

  const migration: LegacyProjectMigrationResult = {
    migratedCount: mappings.length,
    mappings
  };
  const migrationApplied = migration.migratedCount > 0;

  return {
    catalog: {
      projects: normalizedProjects,
      snapshots: normalizedSnapshots,
      metadata: migrationApplied
        ? {
          legacyProjectMigration: {
            pendingNotice: true,
            migratedCount: migration.migratedCount,
            mappings: migration.mappings,
            appliedAt: Date.now()
          }
        }
        : raw.metadata
    },
    migration,
    migrationApplied
  };
}

async function loadCatalog(filePath: string): Promise<{ catalog: CatalogState; writeApplied: boolean }> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      projects?: Record<string, Partial<ProjectRecord> & { projectId?: string; id?: string; name?: string }>;
      snapshots?: Record<string, SnapshotRecord[]>;
      metadata?: CatalogState["metadata"];
    };
    const { catalog, migrationApplied } = migrateLegacyCatalog(raw);
    return { catalog, writeApplied: migrationApplied };
  } catch {
    return { catalog: { projects: {}, snapshots: {} }, writeApplied: false };
  }
}

async function saveCatalog(filePath: string, catalog: CatalogState): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(catalog, null, 2), "utf8");
}

function readProjectIdFromRequest(pathname: string): string | null {
  const match = /^\/v1\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function parseCursor(raw: string | null): Cursor {
  if (!raw) return { metaSeq: 0, graphSeq: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return { metaSeq: parsed.metaSeq ?? 0, graphSeq: parsed.graphSeq ?? 0 };
  } catch {
    return { metaSeq: 0, graphSeq: 0 };
  }
}

function isPollCursorTooOld(lastAppliedCursor: Cursor, minReadableStartCursor: Cursor): boolean {
  // sync:poll uses "cursor" as the last applied event position and reads from cursor+1,
  // so staleness is determined against the effective start sequence, not the cursor itself.
  return lastAppliedCursor.metaSeq + 1 < minReadableStartCursor.metaSeq || lastAppliedCursor.graphSeq + 1 < minReadableStartCursor.graphSeq;
}

function isSubscribeFromTooOld(fromLastAppliedGraphSeq: number, minReadableGraphStartSeq: number): boolean {
  return fromLastAppliedGraphSeq + 1 < minReadableGraphStartSeq;
}

function boundedMinReadableCursor(minReadable: Cursor, head: Cursor): Cursor {
  return {
    metaSeq: Math.max(0, Math.min(minReadable.metaSeq, head.metaSeq)),
    graphSeq: Math.max(0, Math.min(minReadable.graphSeq, head.graphSeq))
  };
}

async function streamSubscribe(
  res: ServerResponse,
  syncPull: (fromCursorVisible: number) => Promise<{ txBundlesVisible: Array<{ principalCursor: number; txBundle: { graphEvents: unknown[] } }>; cursorAfterVisible: number }>,
  initialCursorVisible: number
): Promise<void> {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  let cursor = initialCursorVisible;
  const timer = setInterval(async () => {
    const pulled = await syncPull(cursor);
    if (pulled.txBundlesVisible.length > 0) {
      res.write(`data:${JSON.stringify({ kind: "txBundles", txBundlesVisible: pulled.txBundlesVisible })}\n\n`);
      cursor = pulled.cursorAfterVisible;
      res.write(`data:${JSON.stringify({ kind: "cursor", cursorVisible: cursor })}\n\n`);
      return;
    }
    res.write(`data:${JSON.stringify({ kind: "heartbeat", cursorVisible: cursor })}\n\n`);
  }, 1000);
  (res as unknown as { on: (event: string, listener: () => void) => void }).on("close", () => clearInterval(timer));
}

async function runRetentionJob(
  projects: Record<string, ProjectRecord>,
  ensureProject: (projectId: string, name?: string) => Promise<ProjectRecord>,
  refreshProjectHead: (projectId: string) => Promise<void>,
  createSnapshot: (projectId: string, label?: string) => Promise<SnapshotRecord>,
  purgeHistory: (projectId: string, dryRun?: boolean) => Promise<Record<string, unknown>>
): Promise<void> {
  for (const projectId of Object.keys(projects)) {
    const project = await ensureProject(projectId);
    await refreshProjectHead(projectId);
    const dueByEvents = false;
    const dueByTime = project.updatedAt + project.retentionPolicy.snapshotEverySeconds * 1000 < Date.now();
    if (dueByEvents || dueByTime) await createSnapshot(projectId, "auto");
    if (project.retentionPolicy.ttlSeconds || project.retentionPolicy.maxEvents) await purgeHistory(projectId, false);
  }
}

function buildRootHelpMessage(graphSpaceId: string): string {
  return [
    "mesh-graph-server API endpoint",
    "",
    "This server expects authenticated API requests using header x-mesh-principal.",
    "Useful routes:",
    "  /v1/projects",
    "  /v1/:projectId/sync:poll",
    "  /v1/:projectId/graph:snapshot",
    `default projectId: ${graphSpaceId}`
  ].join("\n");
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
    payload: { ...payload, _acl: maskForOtherPrincipal(principal.principalId) }
  };
  return gateway.submit(graphSpaceId, principal, command, idempotencyKey).final;
}

async function readGraphView(
  gateway: LocalSyncGatewayLike,
  graphSpaceId: string,
  principal: PrincipalContext
): Promise<{ view: GraphView; replayedEventsCount: number; baseCursor: Cursor }> {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();
  const baseCursor: Cursor = { metaSeq: 0, graphSeq: 0 };
  let replayedEventsCount = 0;
  let cursor = 0;
  while (true) {
    const pulled = await gateway.syncPull(graphSpaceId, principal, cursor, { limitTx: 64, limitBytes: 128 * 1024 });
    for (const bundle of pulled.txBundlesVisible) {
      for (const rawEvent of bundle.txBundle.graphEvents) {
        applyGraphEvent(nodes, links, rawEvent as GraphEvent);
        replayedEventsCount += 1;
      }
    }
    if (pulled.cursorAfterVisible === cursor) break;
    cursor = pulled.cursorAfterVisible;
  }
  return {
    view: { nodes: Array.from(nodes.values()), links: Array.from(links.values()).filter((link) => nodes.has(link.source) && nodes.has(link.target)) },
    replayedEventsCount,
    baseCursor
  };
}

function applyGraphEvent(nodes: Map<string, GraphNode>, links: Map<string, GraphLink>, event: GraphEvent): void {
  if (event.type === "graph.node.created") return void nodes.set(event.node.id, event.node);
  if (event.type === "graph.node.label.updated") {
    const existing = nodes.get(event.nodeId);
    if (!existing) return;
    return void nodes.set(event.nodeId, { ...existing, label: event.label });
  }
  if (event.type === "graph.node.deleted") {
    nodes.delete(event.nodeId);
    for (const [id, link] of links) if (link.source === event.nodeId || link.target === event.nodeId) links.delete(id);
    return;
  }
  if (event.type === "graph.link.created") return void links.set(event.link.id, event.link);
  if (event.type === "graph.link.deleted") links.delete(event.linkId);
}

function readIdempotencyKey(req: IncomingMessage, bodyValue?: unknown): string {
  if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue;
  const header = req.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === "string" && value.trim()) return value.trim();
  return randomUUID();
}

function parsePrincipal(req: IncomingMessage): PrincipalContext | null {
  const raw = req.headers[PRINCIPAL_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { principalId: trimmed };
}

function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-mesh-principal,x-idempotency-key,x-mesh-debug-token");
}

function debugEndpointsEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ENABLE_DEBUG_ENDPOINTS !== "0";
}

function hasValidDebugToken(req: IncomingMessage): boolean {
  const raw = req.headers[DEBUG_TOKEN_HEADER];
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const expected = (process.env.MESH_DEBUG_ENDPOINT_TOKEN ?? "mesh-dev-debug-token").trim();
  return Boolean(token) && token === expected;
}

function parseCursorFromBody(input: unknown): Cursor | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as { metaSeq?: unknown; graphSeq?: unknown };
  const metaSeq = toNonNegativeInteger(candidate.metaSeq);
  const graphSeq = toNonNegativeInteger(candidate.graphSeq);
  if (metaSeq == null || graphSeq == null) return null;
  return { metaSeq, graphSeq };
}

function compareCursor(left: Cursor, right: Cursor): number {
  if (left.metaSeq !== right.metaSeq) return left.metaSeq - right.metaSeq;
  return left.graphSeq - right.graphSeq;
}

function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function maskForOtherPrincipal(principal: string): Record<string, "mask"> {
  if (principal === "alice") return { bob: "mask" };
  if (principal === "bob") return { alice: "mask" };
  return {};
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return raw;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function writePlainText(res: ServerResponse, status: number, payload: string): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(payload);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const storageDir = process.env.MESH_GRAPH_STORAGE_DIR ?? ".mesh-graph-data";
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8090;
  startMeshGraphServer({ storageDir, port }).then((server) => {
    process.stdout.write(`mesh-graph-server listening on ${server.url} (graphSpaceId=${server.graphSpaceId})\n`);
  });
}

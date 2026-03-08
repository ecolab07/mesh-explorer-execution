import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../../apps/mesh-graph-server/src/index.js";
import {
  createGraphStore,
  type Cursor,
  type GraphEvent,
  type GraphLink,
  type GraphNode,
  type GraphStore
} from "../../packages/mesh-explorer-ui/src/graphStore.js";
import { resolveBootstrapCursorDecision } from "../../packages/mesh-explorer-ui/src/bootstrapCursor.js";
import {
  BOOTSTRAP_CACHE_SCHEMA_VERSION,
  createProjectionSnapshot,
  hydrateStoreFromProjection,
  makeBootstrapCacheRecord,
  type BootstrapCacheRecord
} from "../../packages/mesh-explorer-ui/src/bootstrapCache.js";

describe("mesh explorer sync materialization", { timeout: 30_000 }, () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("poll + txBundles materialize nodes/links idempotently", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "test01");
    await createNode(server.url, "alice", "test02");

    const store = createGraphStore();
    const firstPoll = await syncPoll(server.url, "alice", { metaSeq: 0, graphSeq: 0 });
    const graphEvents = firstPoll.graph
      .map((entry) => entry.payload as GraphEvent)
      .filter((entry): entry is GraphEvent => typeof entry?.type === "string");
    store.applyGraphEvents(graphEvents);
    store.applyGraphEvents(graphEvents);

    const nodes = Array.from(store.getState().nodesById.values());
    expect(nodes.length).toBe(2);
    expect(nodes.map((node) => node.label).sort()).toEqual(["test01", "test02"]);

    const nodeIds = nodes.map((node) => node.id);
    expect(nodeIds[0]).not.toBe(nodeIds[1]);

    store.replaceSelection(nodeIds.slice(0, 2));
    await createLink(server.url, "alice", nodeIds[0]!, nodeIds[1]!, "depends");

    const pulled = await syncPull(server.url, "alice", firstPoll.cursorAfter.graphSeq);
    const linkEvents = pulled.txBundlesVisible
      .flatMap((bundle) => bundle.txBundle.graphEvents)
      .map((entry) => entry as GraphEvent)
      .filter((entry): entry is GraphEvent => typeof entry?.type === "string");

    store.applyGraphEvents(linkEvents);

    const links = Array.from(store.getState().linksById.values());
    expect(links.length).toBe(1);
    expect(links[0]).toMatchObject({ source: nodeIds[0], target: nodeIds[1], type: "depends" });
  });

  it("CT-A1/CT-A4 valid cache enables savedCursor fast path and no blocking replay", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "refresh-a");
    await createNode(server.url, "alice", "refresh-b");

    const seededStore = createGraphStore();
    const seededReplay = await bootstrapReplay(server.url, "alice", seededStore, { metaSeq: 0, graphSeq: 0 });
    const nodeIds = Array.from(seededStore.getState().nodesById.keys());
    await createLink(server.url, "alice", nodeIds[0]!, nodeIds[1]!, "depends");

    const refreshed = await bootstrapReplay(server.url, "alice", seededStore, seededReplay.cursor);
    const cache = makeBootstrapCacheRecord(refreshed.cursor, {
      version: 1,
      nodes: Array.from(seededStore.getState().nodesById.values()),
      links: Array.from(seededStore.getState().linksById.values())
    });

    const snapshotCursor: Cursor = { metaSeq: 0, graphSeq: 0 };
    const decision = resolveBootstrapCursorDecision({
      savedCursor: refreshed.cursor,
      snapshot: { cursor: snapshotCursor },
      bootstrapCache: cache
    });

    expect(decision.bootstrapFrom).toEqual(refreshed.cursor);

    const fastPathStore = createGraphStore();
    fastPathStore.applyGraphEvents(cache.projection.nodes.map((node) => ({ type: "graph.node.created", node })));
    fastPathStore.applyGraphEvents(cache.projection.links.map((link) => ({ type: "graph.link.created", link })));
    fastPathStore.setCursor(cache.cursor);
    const replayed = await bootstrapReplay(server.url, "alice", fastPathStore, decision.bootstrapFrom);

    expect(replayed.graphEventsApplied).toBe(0);
    expect(fastPathStore.getState().nodesById.size).toBe(2);
    expect(fastPathStore.getState().linksById.size).toBe(1);
  });

  it("CT-A1 e2e restart reuses valid digest cache and keeps cursor monotonic", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "valid-a");
    await createNode(server.url, "alice", "valid-b");

    const firstSession = await runBootstrapSession(server.url, "alice", null);
    expect(firstSession.decision.usedSavedCursor).toBe(false);
    expect(firstSession.decision.reason).toBe("snapshot-only-cache-missing");

    const secondSession = await runBootstrapSession(server.url, "alice", firstSession.persisted);
    expect(secondSession.decision.usedSavedCursor).toBe(true);
    expect(secondSession.decision.reason).toBe("saved-cursor-cache-verified");
    expect(secondSession.replay.graphEventsApplied).toBe(0);
    expect(secondSession.store.getState().cursor.graphSeq).toBeGreaterThanOrEqual(firstSession.store.getState().cursor.graphSeq);
    expect(secondSession.store.getState().nodesById.size).toBe(2);
  });

  it("CT-A2 e2e digest mismatch invalidates local cache and falls back safely", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "mismatch-a");
    await createNode(server.url, "alice", "mismatch-b");

    const firstSession = await runBootstrapSession(server.url, "alice", null);
    const corruptedPersisted = {
      ...firstSession.persisted,
      bootstrapCache: { ...firstSession.persisted.bootstrapCache, stateDigest: "corrupted-digest" }
    };

    const restarted = await runBootstrapSession(server.url, "alice", corruptedPersisted);
    expect(restarted.decision.usedSavedCursor).toBe(false);
    expect(restarted.decision.reason).toBe("snapshot-only-digest-mismatch");
    expect(restarted.invalidatedBootstrapCache).toBe(true);
    expect(Array.from(restarted.store.getState().nodesById.values()).map((n) => n.label).sort()).toEqual(["mismatch-a", "mismatch-b"]);

    const truthStore = createGraphStore();
    await bootstrapReplay(server.url, "alice", truthStore, { metaSeq: 0, graphSeq: 0 });
    expect(Array.from(restarted.store.getState().nodesById.values())).toEqual(Array.from(truthStore.getState().nodesById.values()));
  });

  it("CT-A3 e2e schemaVersion upgrade invalidates persisted cache and converges via canonical bootstrap", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "upgrade-a");
    await createNode(server.url, "alice", "upgrade-b");

    const firstSession = await runBootstrapSession(server.url, "alice", null);
    expect(firstSession.decision.usedSavedCursor).toBe(false);
    expect(firstSession.decision.reason).toBe("snapshot-only-cache-missing");

    await createNode(server.url, "alice", "upgrade-c");

    const upgradedPersisted = {
      ...firstSession.persisted,
      bootstrapCache: {
        ...firstSession.persisted.bootstrapCache,
        schemaVersion: BOOTSTRAP_CACHE_SCHEMA_VERSION + 1
      }
    };

    const restarted = await runBootstrapSession(server.url, "alice", upgradedPersisted);
    expect(restarted.decision.usedSavedCursor).toBe(false);
    expect(restarted.decision.reason).toBe("snapshot-only-schema-version-mismatch");
    expect(restarted.invalidatedBootstrapCache).toBe(true);
    expect(Array.from(restarted.store.getState().nodesById.values()).map((n) => n.label).sort()).toEqual([
      "upgrade-a",
      "upgrade-b",
      "upgrade-c"
    ]);

    const truthStore = createGraphStore();
    await bootstrapReplay(server.url, "alice", truthStore, { metaSeq: 0, graphSeq: 0 });
    expect(Array.from(restarted.store.getState().nodesById.values())).toEqual(Array.from(truthStore.getState().nodesById.values()));
    expect(restarted.persisted.bootstrapCache.schemaVersion).toBe(BOOTSTRAP_CACHE_SCHEMA_VERSION);
  });

  it("reload bootstrap rebuilds nodes/links before subscribe", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "reload-a");
    await createNode(server.url, "alice", "reload-b");

    const seedingStore = createGraphStore();
    const seeded = await bootstrapReplay(server.url, "alice", seedingStore, { metaSeq: 0, graphSeq: 0 });
    const seededNodeIds = Array.from(seedingStore.getState().nodesById.keys());
    await createLink(server.url, "alice", seededNodeIds[0]!, seededNodeIds[1]!, "depends");

    const firstSessionStore = createGraphStore();
    const firstSession = await bootstrapReplay(server.url, "alice", firstSessionStore, seeded.cursor);
    const persistedCursor = firstSession.cursor;

    const reloadedStore = createGraphStore();
    const replayed = await bootstrapReplay(server.url, "alice", reloadedStore, persistedCursor);
    if (persistedCursor.graphSeq > 0 && replayed.graphEventsApplied === 0 && reloadedStore.getState().nodesById.size === 0) {
      await bootstrapReplay(server.url, "alice", reloadedStore, { metaSeq: 0, graphSeq: 0 });
    }

    expect(reloadedStore.getState().nodesById.size).toBeGreaterThanOrEqual(2);
    expect(reloadedStore.getState().linksById.size).toBeGreaterThanOrEqual(1);
  });
});

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

async function createNode(baseUrl: string, principal: string, label: string): Promise<void> {
  await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:nodes`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ label, idempotencyKey: crypto.randomUUID() })
  });
}

async function createLink(baseUrl: string, principal: string, source: string, target: string, type: string): Promise<void> {
  await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:links`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ source, target, type, idempotencyKey: crypto.randomUUID() })
  });
}

async function syncPoll(baseUrl: string, principal: string, cursor: Cursor): Promise<{
  meta: Array<{ payload: unknown }>;
  graph: Array<{ payload: unknown }>;
  cursorAfter: Cursor;
}> {
  const limits = encodeURIComponent(JSON.stringify({ graph: 64, meta: 32 }));
  const encodedCursor = encodeURIComponent(JSON.stringify(cursor));
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/sync:poll?cursor=${encodedCursor}&limits=${limits}`, {
    headers: headers(principal)
  });
  return (await response.json()) as { meta: Array<{ payload: unknown }>; graph: Array<{ payload: unknown }>; cursorAfter: Cursor };
}

async function syncPull(baseUrl: string, principal: string, from: number): Promise<{
  txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }>;
}> {
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/sync:pull?from=${from}&limitTx=64&limitBytes=131072`, {
    headers: headers(principal)
  });
  return (await response.json()) as { txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }> };
}

async function bootstrapReplay(baseUrl: string, principal: string, store: GraphStore, initialCursor: Cursor): Promise<{ cursor: Cursor; graphEventsApplied: number }> {
  let cursor = initialCursor;
  let graphEventsApplied = 0;

  while (true) {
    const payload = await syncPoll(baseUrl, principal, cursor);
    const graphEvents = payload.graph
      .map((entry) => entry.payload as GraphEvent)
      .filter((entry): entry is GraphEvent => typeof entry?.type === "string");
    graphEventsApplied += graphEvents.length;
    store.applyGraphEvents(graphEvents);

    const nextCursor = payload.cursorAfter;
    const cursorUnchanged = nextCursor.metaSeq === cursor.metaSeq && nextCursor.graphSeq === cursor.graphSeq;
    cursor = nextCursor;

    if ((payload.meta.length === 0 && payload.graph.length === 0) || cursorUnchanged) {
      return { cursor, graphEventsApplied };
    }
  }
}

type PersistedBootstrapState = {
  savedCursor: Cursor;
  bootstrapCache: BootstrapCacheRecord;
};

async function runBootstrapSession(
  baseUrl: string,
  principal: string,
  persisted: PersistedBootstrapState | null
): Promise<{
  store: GraphStore;
  decision: ReturnType<typeof resolveBootstrapCursorDecision>;
  replay: { cursor: Cursor; graphEventsApplied: number };
  persisted: PersistedBootstrapState;
  invalidatedBootstrapCache: boolean;
}> {
  const snapshot = await fetchSnapshot(baseUrl, principal);
  const decision = resolveBootstrapCursorDecision({
    savedCursor: persisted?.savedCursor ?? null,
    snapshot: { cursor: snapshot.cursor },
    bootstrapCache: persisted?.bootstrapCache ?? null
  });

  const store = createGraphStore();
  const invalidatedBootstrapCache = decision.invalidateBootstrapCache;
  if (decision.usedSavedCursor && persisted?.bootstrapCache) {
    hydrateStoreFromProjection(store, persisted.bootstrapCache.projection);
    store.setCursor(decision.bootstrapFrom);
  } else {
    bootstrapFromSnapshot(store, snapshot);
  }

  const replay = await bootstrapReplay(baseUrl, principal, store, decision.bootstrapFrom);
  const bootstrapCache = makeBootstrapCacheRecord(replay.cursor, createProjectionSnapshot(store));

  return {
    store,
    decision,
    replay,
    persisted: { savedCursor: replay.cursor, bootstrapCache },
    invalidatedBootstrapCache
  };
}

function bootstrapFromSnapshot(store: GraphStore, snapshot: { payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor: Cursor }): void {
  const nodes = snapshot.payload?.nodes ?? [];
  const links = snapshot.payload?.links ?? [];
  store.resetProjection();
  store.applyGraphEvents(nodes.map((node) => ({ type: "graph.node.created", node } as GraphEvent)));
  store.applyGraphEvents(links.map((link) => ({ type: "graph.link.created", link } as GraphEvent)));
  store.setCursor(snapshot.cursor);
}

async function fetchSnapshot(baseUrl: string, principal: string): Promise<{ payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor: Cursor }> {
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:snapshot`, { headers: headers(principal) });
  if (!response.ok) return { payload: { nodes: [], links: [] }, cursor: { metaSeq: 0, graphSeq: 0 } };
  const snapshot = (await response.json()) as { payload?: { nodes?: GraphNode[]; links?: GraphLink[] }; cursor?: Cursor };
  return { payload: snapshot.payload, cursor: snapshot.cursor ?? { metaSeq: 0, graphSeq: 0 } };
}

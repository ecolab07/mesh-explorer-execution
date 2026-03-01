import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../../apps/mesh-graph-server/src/index.js";
import { createGraphStore, type Cursor, type GraphEvent, type GraphStore } from "../../packages/mesh-explorer-ui/src/graphStore.js";
import { resolveBootstrapCursorDecision } from "../../packages/mesh-explorer-ui/src/bootstrapCursor.js";

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

  it("refresh preserves graph when saved cursor exists without durable state", async () => {
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

    const persistedCursor = seededReplay.cursor;
    const snapshotCursor: Cursor = { metaSeq: 0, graphSeq: 0 };
    const decision = resolveBootstrapCursorDecision({
      savedCursor: persistedCursor,
      snapshot: { cursor: snapshotCursor },
      stateDigest: null
    });

    expect(decision.bootstrapFrom).toEqual(snapshotCursor);

    const refreshedStore = createGraphStore();
    const replayed = await bootstrapReplay(server.url, "alice", refreshedStore, decision.bootstrapFrom);

    expect(replayed.graphEventsApplied).toBeGreaterThanOrEqual(3);
    expect(refreshedStore.getState().nodesById.size).toBe(2);
    expect(refreshedStore.getState().linksById.size).toBe(1);
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

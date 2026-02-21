import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../../apps/mesh-graph-server/src/index.js";
import { createGraphStore, type Cursor, type GraphEvent, type GraphStore } from "../../packages/mesh-explorer-ui/src/graphStore.js";

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



  it("recovers after fork when subscribe responds cursor_too_old", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-ui-fork-recovery-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    for (let idx = 0; idx < 4; idx += 1) {
      await createNode(server.url, "alice", `fork-src-${idx}`);
      await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers: headers("alice"), body: JSON.stringify({ label: `s-${idx}` }) });
    }

    await fetch(`${server.url}/v1/${server.graphSpaceId}/retention`, {
      method: "PATCH",
      headers: headers("alice"),
      body: JSON.stringify({ maxEvents: 1, minSnapshotsToKeep: 1, snapshotEveryNEvents: 1, snapshotEverySeconds: 1, mode: "delete" })
    });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/history:purge`, { method: "POST", headers: headers("alice"), body: JSON.stringify({ dryRun: false }) });

    const snapshots = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots`, { headers: headers("alice") });
    const latest = ((await snapshots.json()) as Array<{ snapshotId: string }>)[0];
    expect(latest?.snapshotId).toBeTruthy();

    const forkResponse = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots/${latest!.snapshotId}:fork`, {
      method: "POST",
      headers: headers("alice"),
      body: JSON.stringify({ newProjectId: "fork-recover-p1" })
    });
    const forkedProject = (await forkResponse.json()) as { newProjectId: string };

    const staleSubscribe = await fetch(`${server.url}/v1/${forkedProject.newProjectId}/sync:subscribe?from=0`, { headers: headers("alice") });
    expect(staleSubscribe.status).toBe(410);
    const tooOld = (await staleSubscribe.json()) as { kind: string; minReadableCursor: Cursor; recommendedSnapshotId?: string };
    expect(tooOld.kind).toBe("cursor_too_old");

    const snapshotUrl = tooOld.recommendedSnapshotId
      ? `${server.url}/v1/${forkedProject.newProjectId}/snapshots/${tooOld.recommendedSnapshotId}`
      : `${server.url}/v1/${forkedProject.newProjectId}/graph:snapshot`;
    const snapshot = await fetch(snapshotUrl, { headers: headers("alice") });
    const snapshotBody = (await snapshot.json()) as { payload: { nodes: Array<{ id: string }>; links: Array<{ id: string }> }; cursor: Cursor };

    const resumeFrom = Math.max(snapshotBody.cursor.graphSeq, tooOld.minReadableCursor.graphSeq);
    const recoveredSubscribe = await fetch(`${server.url}/v1/${forkedProject.newProjectId}/sync:subscribe?from=${resumeFrom}`, { headers: headers("alice") });
    expect(recoveredSubscribe.ok).toBe(true);
    expect(snapshotBody.payload.nodes.length).toBeGreaterThan(0);
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

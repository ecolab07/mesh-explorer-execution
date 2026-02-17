import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../../apps/mesh-graph-server/src/index.js";
import { createGraphStore, type GraphEvent } from "../../packages/mesh-explorer-ui/src/graphStore.js";

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
    const cursor = { metaSeq: 0, graphSeq: 0 };
    const firstPoll = await syncPoll(server.url, "alice", cursor);
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

    const from = firstPoll.cursorAfter;
    const pulled = await syncPull(server.url, "alice", from.graphSeq);
    const linkEvents = pulled.txBundlesVisible
      .flatMap((bundle) => bundle.txBundle.graphEvents)
      .map((entry) => entry as GraphEvent)
      .filter((entry): entry is GraphEvent => typeof entry?.type === "string");

    store.applyGraphEvents(linkEvents);

    const links = Array.from(store.getState().linksById.values());
    expect(links.length).toBe(1);
    expect(links[0]).toMatchObject({ source: nodeIds[0], target: nodeIds[1], type: "depends" });
  });
});

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

async function createNode(baseUrl: string, principal: string, label: string): Promise<void> {
  await fetch(`${baseUrl}/graph/nodes`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ label, idempotencyKey: crypto.randomUUID() })
  });
}

async function createLink(baseUrl: string, principal: string, source: string, target: string, type: string): Promise<void> {
  await fetch(`${baseUrl}/graph/links`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ source, target, type, idempotencyKey: crypto.randomUUID() })
  });
}

async function syncPoll(baseUrl: string, principal: string, cursor: { metaSeq: number; graphSeq: number }): Promise<{
  graph: Array<{ payload: unknown }>;
  cursorAfter: { metaSeq: number; graphSeq: number };
}> {
  const limits = encodeURIComponent(JSON.stringify({ graph: 64, meta: 32 }));
  const encodedCursor = encodeURIComponent(JSON.stringify(cursor));
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/sync:poll?cursor=${encodedCursor}&limits=${limits}`, {
    headers: headers(principal)
  });
  return (await response.json()) as { graph: Array<{ payload: unknown }>; cursorAfter: { metaSeq: number; graphSeq: number } };
}

async function syncPull(baseUrl: string, principal: string, from: number): Promise<{
  txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }>;
}> {
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/sync:pull?from=${from}&limitTx=64&limitBytes=131072`, {
    headers: headers(principal)
  });
  return (await response.json()) as { txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }> };
}

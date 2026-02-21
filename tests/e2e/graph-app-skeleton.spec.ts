import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../../apps/mesh-graph-server/src/index.js";

describe("graph app skeleton", { timeout: 30_000 }, () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("add node + restart + recovery", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    let server: MeshGraphServerHandle = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "n1", "Node 1");
    await createNode(server.url, "alice", "n2", "Node 2");
    expect(await graphView(server.url, "alice")).toEqual({
      nodes: [
        { id: "n1", label: "Node 1" },
        { id: "n2", label: "Node 2" }
      ],
      links: []
    });

    await server.close();
    server = await startMeshGraphServer({ storageDir, port: 0 });

    expect(await graphView(server.url, "alice")).toEqual({
      nodes: [
        { id: "n1", label: "Node 1" },
        { id: "n2", label: "Node 2" }
      ],
      links: []
    });
  });

  it("add typed link", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "n1", "Node 1");
    await createNode(server.url, "alice", "n2", "Node 2");
    await createLink(server.url, "alice", "l1", "n1", "n2", "depends");

    expect(await graphView(server.url, "alice")).toEqual({
      nodes: [
        { id: "n1", label: "Node 1" },
        { id: "n2", label: "Node 2" }
      ],
      links: [{ id: "l1", source: "n1", target: "n2", type: "depends" }]
    });
  });

  it("multi-principal isolation", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server = await startMeshGraphServer({ storageDir, port: 0 });
    cleanups.push(async () => server.close());

    await createNode(server.url, "alice", "na", "Alice node");

    expect(await graphView(server.url, "alice")).toEqual({ nodes: [{ id: "na", label: "Alice node" }], links: [] });
    expect(await graphView(server.url, "bob")).toEqual({ nodes: [], links: [] });
  });
});

async function createNode(baseUrl: string, principal: string, id: string, label: string): Promise<void> {
  await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:nodes`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ id, label, idempotencyKey: `node-${id}` })
  });
}

async function createLink(baseUrl: string, principal: string, id: string, source: string, target: string, type: string): Promise<void> {
  await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:links`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ id, source, target, type, idempotencyKey: `link-${id}` })
  });
}

async function graphView(baseUrl: string, principal: string): Promise<{ nodes: Array<{ id: string; label: string }>; links: Array<{ id: string; source: string; target: string; type: string }> }> {
  const response = await fetch(`${baseUrl}/v1/mesh-explorer-graph-v1/graph:view`, { headers: headers(principal) });
  const payload = (await response.json()) as { nodes: Array<{ id: string; label: string }>; links: Array<{ id: string; source: string; target: string; type: string }> };
  return payload;
}

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

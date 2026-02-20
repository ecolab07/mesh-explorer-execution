import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../src/index";

describe("mesh graph server mutations", () => {
  const startedServers: MeshGraphServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(startedServers.splice(0).map((server) => server.close()));
  });

  it("deletes links, deletes nodes with link cascade, and renames nodes", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-mutations-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    const headers = { "content-type": "application/json", "x-mesh-principal": "local-dev" };
    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "A", label: "A" }) });
    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "B", label: "B" }) });
    await fetch(`${server.url}/graph/links`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "L1", source: "A", target: "B", type: "related" })
    });

    const deleteLink = await fetch(`${server.url}/graph/links/L1`, { method: "DELETE", headers });
    expect(deleteLink.status).toBe(200);

    await fetch(`${server.url}/graph/links`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "L2", source: "A", target: "B", type: "related" })
    });

    const rename = await fetch(`${server.url}/graph/nodes/A`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ label: "A-renamed" })
    });
    expect(rename.status).toBe(200);

    const deleteNode = await fetch(`${server.url}/graph/nodes/A`, { method: "DELETE", headers });
    expect(deleteNode.status).toBe(200);

    const viewResponse = await fetch(`${server.url}/graph/view`, { headers });
    const view = (await viewResponse.json()) as { nodes: Array<{ id: string; label: string }>; links: Array<{ id: string }> };

    expect(view.nodes.find((node) => node.id === "A")).toBeUndefined();
    expect(view.nodes.find((node) => node.id === "B")).toBeDefined();
    expect(view.links.find((link) => link.id === "L1")).toBeUndefined();
    expect(view.links.find((link) => link.id === "L2")).toBeUndefined();
  });

  it("keeps explicit ids for node/link create payloads", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-create-id-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    const headers = { "content-type": "application/json", "x-mesh-principal": "local-dev" };
    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "Node-Explicit", label: "Node" }) });
    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "Node-Target", label: "Target" }) });
    await fetch(`${server.url}/graph/links`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "Link-Explicit", source: "Node-Explicit", target: "Node-Target", type: "related" })
    });

    const viewResponse = await fetch(`${server.url}/graph/view`, { headers });
    const view = (await viewResponse.json()) as { nodes: Array<{ id: string }>; links: Array<{ id: string }> };

    expect(view.nodes.some((node) => node.id === "Node-Explicit")).toBe(true);
    expect(view.links.some((link) => link.id === "Link-Explicit")).toBe(true);
  });
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../src/index";

describe("projects + snapshots + retention", () => {
  const startedServers: MeshGraphServerHandle[] = [];
  const headers = { "content-type": "application/json", "x-mesh-principal": "local-dev" };

  afterEach(async () => {
    await Promise.all(startedServers.splice(0).map((server) => server.close()));
  });

  it("creates/lists/gets snapshots and supports fork", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-projects-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "A", label: "A" }) });
    await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: "B", label: "B" }) });
    await fetch(`${server.url}/graph/links`, { method: "POST", headers, body: JSON.stringify({ id: "L", source: "A", target: "B", type: "related" }) });

    const created = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: "manual" }) });
    const createdBody = (await created.json()) as { snapshotId: string };
    expect(createdBody.snapshotId).toBeTruthy();

    const listed = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots`, { headers });
    const listBody = (await listed.json()) as Array<{ snapshotId: string }>;
    expect(listBody.length).toBeGreaterThanOrEqual(1);

    const read = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots/${createdBody.snapshotId}`, { headers });
    const snapshot = (await read.json()) as { payload: { nodes: Array<{ id: string }>; links: Array<{ id: string }> } };
    expect(snapshot.payload.nodes.length).toBe(2);
    expect(snapshot.payload.links.length).toBe(1);

    const fork = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots/${createdBody.snapshotId}:fork`, {
      method: "POST",
      headers,
      body: JSON.stringify({ newProjectId: "fork-p1" })
    });
    const forkBody = (await fork.json()) as { newProjectId: string };
    expect(forkBody.newProjectId).toBe("fork-p1");

    const forkSnapshot = await fetch(`${server.url}/v1/fork-p1/graph:snapshot`, { headers });
    const forkSnapshotBody = (await forkSnapshot.json()) as { payload: { nodes: unknown[]; links: unknown[] } };
    expect(forkSnapshotBody.payload.nodes.length).toBe(2);
    expect(forkSnapshotBody.payload.links.length).toBe(1);
  });

  it("purges history and returns cursor_too_old", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-retention-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    await fetch(`${server.url}/v1/${server.graphSpaceId}/retention`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ maxEvents: 1, minSnapshotsToKeep: 1, snapshotEveryNEvents: 1, snapshotEverySeconds: 1, mode: "delete" })
    });

    for (let idx = 0; idx < 3; idx += 1) {
      await fetch(`${server.url}/graph/nodes`, { method: "POST", headers, body: JSON.stringify({ id: `N-${idx}`, label: `N-${idx}` }) });
      await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: `s-${idx}` }) });
    }

    const purge = await fetch(`${server.url}/v1/${server.graphSpaceId}/history:purge`, { method: "POST", headers, body: JSON.stringify({ dryRun: false }) });
    const purgeBody = (await purge.json()) as { newMinReadableCursor: { graphSeq: number } };
    expect(purgeBody.newMinReadableCursor.graphSeq).toBeGreaterThan(0);

    const oldPoll = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 0 }))}`, { headers });
    expect(oldPoll.status).toBe(410);
    await expect(oldPoll.json()).resolves.toMatchObject({ kind: "cursor_too_old" });
  });
});

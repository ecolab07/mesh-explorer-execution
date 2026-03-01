import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../src/index";

async function readSseFrame(response: Response, timeoutMs = 5000): Promise<unknown> {
  if (!response.body) throw new Error("missing SSE body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = Date.now() + timeoutMs;

  while (Date.now() < timeout) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.indexOf("\n\n");
    if (boundary === -1) continue;
    const frameText = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const dataLine = frameText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    return JSON.parse(dataLine.slice("data:".length));
  }

  throw new Error("timed out waiting for SSE frame");
}

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

    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: "A", label: "A" }) });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: "B", label: "B" }) });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:links`, { method: "POST", headers, body: JSON.stringify({ id: "L", source: "A", target: "B", type: "related" }) });

    const created = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: "manual" }) });
    const createdBody = (await created.json()) as { snapshotId: string };
    expect(createdBody.snapshotId).toBeTruthy();

    const listed = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots`, { headers });
    const listBody = (await listed.json()) as Array<{ snapshotId: string; graphSpaceId?: string }>;
    expect(listBody.length).toBeGreaterThanOrEqual(1);
    expect(listBody[0]?.graphSpaceId).toBe(server.graphSpaceId);

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



  it("creates repeated auto snapshots when head crosses multiple thresholds", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-auto-snapshots-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    await fetch(`${server.url}/v1/${server.graphSpaceId}/retention`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ snapshotEveryNEvents: 50, snapshotEverySeconds: 3600, minSnapshotsToKeep: 1, mode: "delete" })
    });

    for (let idx = 0; idx < 155; idx += 1) {
      await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: `auto-${idx}`, label: `auto-${idx}` }) });
    }

    const listed = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots`, { headers });
    const snapshots = (await listed.json()) as Array<{ snapshotId: string; cursor: { graphSeq: number } }>;
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    const heads = snapshots.map((entry) => entry.cursor.graphSeq).sort((a, b) => a - b);
    expect(heads.some((head) => head >= 50)).toBe(true);
    expect(heads.some((head) => head >= 100)).toBe(true);
    expect(heads.some((head) => head >= 150)).toBe(true);
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
      await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: `N-${idx}`, label: `N-${idx}` }) });
      await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: `s-${idx}` }) });
    }

    const purge = await fetch(`${server.url}/v1/${server.graphSpaceId}/history:purge`, { method: "POST", headers, body: JSON.stringify({ dryRun: false }) });
    const purgeBody = (await purge.json()) as { newMinReadableCursor: { graphSeq: number } };
    expect(purgeBody.newMinReadableCursor.graphSeq).toBeGreaterThan(0);

    const oldPoll = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 0 }))}`, { headers });
    expect(oldPoll.status).toBe(410);
    await expect(oldPoll.json()).resolves.toMatchObject({ kind: "cursor_too_old" });
  });

  it("applies subscribe from cursor and does not replay history", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-subscribe-from-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    for (let idx = 1; idx <= 5; idx += 1) {
      await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: `N-${idx}`, label: `N-${idx}` })
      });
    }

    const subscribeAbort = new AbortController();
    const subscribe = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:subscribe?from=3`, {
      headers,
      signal: subscribeAbort.signal
    });
    expect(subscribe.status).toBe(200);

    let frame = await readSseFrame(subscribe);
    while ((frame as { kind?: string }).kind !== "txBundles") {
      frame = await readSseFrame(subscribe);
    }

    const txBundles = (frame as { txBundlesVisible: Array<{ principalCursor: number }> }).txBundlesVisible;
    expect(txBundles.length).toBeGreaterThan(0);
    expect(txBundles[0]?.principalCursor).toBe(4);
    expect(txBundles.every((bundle) => bundle.principalCursor > 3)).toBe(true);

    subscribeAbort.abort();
  });
});

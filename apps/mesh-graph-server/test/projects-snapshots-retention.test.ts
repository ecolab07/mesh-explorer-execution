import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyCatalog, startMeshGraphServer, type MeshGraphServerHandle } from "../src/index";

describe("projects + snapshots + retention", () => {
  const startedServers: MeshGraphServerHandle[] = [];
  const headers = { "content-type": "application/json", "x-mesh-principal": "local-dev" };

  afterEach(async () => {
    await Promise.all(startedServers.splice(0).map((server) => server.close()));
  });



  it("creates projects with UUID ids, persists names, and supports rename", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-project-create-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    const create = await fetch(`${server.url}/v1/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "J" })
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; name: string; graphSpaceId: string };
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(created.name).toBe("J");
    expect(created.graphSpaceId).toBe(created.id);

    const rename = await fetch(`${server.url}/v1/projects/${created.id}/name`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Renamed project" })
    });
    expect(rename.status).toBe(200);

    const projects = await fetch(`${server.url}/v1/projects`, { headers });
    const list = (await projects.json()) as Array<{ id: string; name: string; graphSpaceId: string }>;
    const createdEntry = list.find((entry) => entry.id === created.id);
    expect(createdEntry?.name).toBe("Renamed project");
    expect(createdEntry?.graphSpaceId).toBe(createdEntry?.id);

    const projectRead = await fetch(`${server.url}/v1/${created.id}`, { headers });
    expect(projectRead.status).toBe(200);
    const projectPayload = (await projectRead.json()) as { headCursor?: { graphSeq: number }; serverCursor?: { graphSeq: number } };
    expect(projectPayload.serverCursor?.graphSeq).toBe(projectPayload.headCursor?.graphSeq);
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
      body: JSON.stringify({ name: "fork-p1" })
    });
    const forkBody = (await fork.json()) as { newProjectId: string };
    expect(forkBody.newProjectId).toMatch(/^[0-9a-f-]{36}$/i);

    const forkSnapshot = await fetch(`${server.url}/v1/${forkBody.newProjectId}/graph:snapshot`, { headers });
    const forkSnapshotBody = (await forkSnapshot.json()) as { payload: { nodes: unknown[]; links: unknown[] } };
    expect(forkSnapshotBody.payload.nodes.length).toBe(2);
    expect(forkSnapshotBody.payload.links.length).toBe(1);
  });

  it("reports legacy migration mappings and logs migration only once across restarts", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-legacy-migration-"));
    const catalogPath = join(storageDir, "mesh-projects.json");
    await writeFile(catalogPath, JSON.stringify({
      projects: {
        J: {
          id: "J",
          headCursor: { metaSeq: 0, graphSeq: 0 },
          minReadableCursor: { metaSeq: 0, graphSeq: 0 },
          retentionPolicy: { snapshotEveryNEvents: 10, snapshotEverySeconds: 10, minSnapshotsToKeep: 1, mode: "delete" }
        }
      },
      snapshots: {}
    }), "utf8");

    const migrationProbe = migrateLegacyCatalog({
      projects: {
        J: {
          id: "J",
          headCursor: { metaSeq: 0, graphSeq: 0 },
          minReadableCursor: { metaSeq: 0, graphSeq: 0 },
          retentionPolicy: { snapshotEveryNEvents: 10, snapshotEverySeconds: 10, minSnapshotsToKeep: 1, mode: "delete" }
        }
      },
      snapshots: {}
    });
    expect(migrationProbe.migration).toMatchObject({
      migratedCount: 1,
      mappings: [
        { oldId: "J", derivedName: "J" }
      ]
    });
    expect(migrationProbe.migration.mappings[0]?.newId).toMatch(/^[0-9a-f-]{36}$/i);

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    expect(infoSpy).toHaveBeenCalledWith("[mesh-graph-server] migrated legacy projects", expect.objectContaining({
      migratedCount: 1,
      mappings: [expect.objectContaining({ oldId: "J", derivedName: "J" })]
    }));

    const projects = await fetch(`${server.url}/v1/projects`, { headers });
    expect(projects.headers.get("x-mesh-legacy-migration-count")).toBe("1");
    const firstPayload = (await projects.json()) as Array<{ id: string; name: string }>;
    expect(firstPayload.some((entry) => entry.name === "J")).toBe(true);

    await server.close();
    startedServers.pop();

    const afterFirstBootCalls = infoSpy.mock.calls.length;
    const restarted = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(restarted);
    expect(infoSpy.mock.calls.length).toBe(afterFirstBootCalls);

    const restartedProjects = await fetch(`${restarted.url}/v1/projects`, { headers });
    expect(restartedProjects.headers.get("x-mesh-legacy-migration-count")).toBe("1");

    infoSpy.mockRestore();
  });




  it("keeps fork cursors consistent and allows subscribe from head", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-fork-invariant-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    for (let idx = 0; idx < 4; idx += 1) {
      await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: `F-${idx}`, label: `F-${idx}` }) });
      await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: `f-${idx}` }) });
    }

    await fetch(`${server.url}/v1/${server.graphSpaceId}/retention`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ maxEvents: 1, minSnapshotsToKeep: 1, snapshotEveryNEvents: 1, snapshotEverySeconds: 1, mode: "delete" })
    });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/history:purge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: false })
    });

    const snapshots = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots`, { headers });
    const latest = ((await snapshots.json()) as Array<{ snapshotId: string }>)[0];
    expect(latest?.snapshotId).toBeTruthy();

    const forkResponse = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots/${latest!.snapshotId}:fork`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "fork-invariant" })
    });
    expect(forkResponse.status).toBe(200);
    const forkPayload = (await forkResponse.json()) as { newProjectId: string };

    const projects = await fetch(`${server.url}/v1/projects`, { headers });
    const forked = ((await projects.json()) as Array<{ projectId: string; headCursor: { graphSeq: number }; minReadableCursor: { graphSeq: number } }>)
      .find((entry) => entry.projectId === forkPayload.newProjectId);

    expect(forked).toBeDefined();
    expect(forked!.minReadableCursor.graphSeq).toBeGreaterThanOrEqual(0);
    expect(forked!.headCursor.graphSeq).toBeGreaterThanOrEqual(forked!.minReadableCursor.graphSeq);

    const subscribe = await fetch(`${server.url}/v1/${forkPayload.newProjectId}/sync:subscribe?from=${forked!.headCursor.graphSeq}`, { headers });
    expect(subscribe.status).toBe(200);
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

  it("gates debug cursor endpoint in production mode", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDebugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS;
    const prevDebugToken = process.env.MESH_DEBUG_ENDPOINT_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.ENABLE_DEBUG_ENDPOINTS = "1";
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = "debug-token";

    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-debug-gate-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    const response = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 1 },
        dryRun: true
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "DEBUG_ENDPOINTS.DISABLED" });

    process.env.NODE_ENV = prevNodeEnv;
    process.env.ENABLE_DEBUG_ENDPOINTS = prevDebugEnabled;
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = prevDebugToken;
  });

  it("supports dry-run, monotonic minReadable advance, and scope validation", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDebugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS;
    const prevDebugToken = process.env.MESH_DEBUG_ENDPOINT_TOKEN;
    process.env.NODE_ENV = "test";
    process.env.ENABLE_DEBUG_ENDPOINTS = "1";
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = "debug-token";

    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-debug-min-readable-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "D-1", label: "D-1" })
    });

    const dryRun = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 1 },
        dryRun: true
      })
    });
    expect(dryRun.status).toBe(200);
    const dryRunBody = (await dryRun.json()) as { advanced: boolean; previousMinReadableCursor: { graphSeq: number }; appliedMinReadableCursor: { graphSeq: number } };
    expect(dryRunBody.advanced).toBe(true);
    expect(dryRunBody.previousMinReadableCursor.graphSeq).toBe(0);
    expect(dryRunBody.appliedMinReadableCursor.graphSeq).toBe(0);

    const apply = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 1 },
        dryRun: false
      })
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({ advanced: true, appliedMinReadableCursor: { graphSeq: 1 } });

    const nonMonotonic = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 1 },
        dryRun: false
      })
    });
    await expect(nonMonotonic.json()).resolves.toMatchObject({ advanced: false, appliedMinReadableCursor: { graphSeq: 1 } });


    const beyondHead = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 2 },
        dryRun: false
      })
    });
    expect(beyondHead.status).toBe(400);
    await expect(beyondHead.json()).resolves.toMatchObject({ reasonCode: "CURSOR.BEYOND_HEAD" });

    const stalePoll = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 0 }))}`, { headers });
    expect(stalePoll.status).toBe(200);
    const stalePollBody = (await stalePoll.json()) as { graph: Array<{ seq: number }>; cursorAfter: { graphSeq: number } };
    expect(stalePollBody.graph[0]?.seq).toBe(1);
    expect(stalePollBody.cursorAfter.graphSeq).toBeGreaterThanOrEqual(1);

    const missingScope = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: "00000000-0000-4000-8000-000000000099",
        graphSpaceId: "00000000-0000-4000-8000-000000000099",
        newMinReadableCursor: { metaSeq: 0, graphSeq: 1 },
        dryRun: true
      })
    });
    expect(missingScope.status).toBe(404);

    process.env.NODE_ENV = prevNodeEnv;
    process.env.ENABLE_DEBUG_ENDPOINTS = prevDebugEnabled;
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = prevDebugToken;
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

  it("enforces minReadable as startSeq for poll and subscribe without off-by-one", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDebugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS;
    const prevDebugToken = process.env.MESH_DEBUG_ENDPOINT_TOKEN;
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEBUG_ENDPOINTS = "1";
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = "debug-token";

    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-min-readable-off-by-one-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    for (let idx = 1; idx <= 8; idx += 1) {
      const createNode = await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: `MR-${idx}`, label: `MR-${idx}` })
      });
      expect(createNode.status).toBe(200);
    }

    const snapshot = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "pre-min-readable" })
    });
    const snapshotBody = (await snapshot.json()) as { snapshotId: string };
    expect(snapshotBody.snapshotId).toBeTruthy();

    const applyMinReadable = await fetch(`${server.url}/debug/advance-min-readable-cursor`, {
      method: "POST",
      headers: { ...headers, "x-mesh-debug-token": "debug-token" },
      body: JSON.stringify({
        projectId: server.graphSpaceId,
        graphSpaceId: server.graphSpaceId,
        newMinReadableCursor: { metaSeq: 0, graphSeq: 6 },
        dryRun: false
      })
    });
    expect(applyMinReadable.status).toBe(200);

    const allowedPoll = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 5 }))}`, { headers });
    expect(allowedPoll.status).toBe(200);
    const allowedPollBody = (await allowedPoll.json()) as { graph: Array<{ seq: number }>; cursorAfter: { graphSeq: number } };
    expect(allowedPollBody.graph.length).toBeGreaterThan(0);
    expect(allowedPollBody.graph[0]?.seq).toBe(6);
    expect(allowedPollBody.cursorAfter.graphSeq).toBeGreaterThanOrEqual(6);

    const stalePoll = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 4 }))}`, { headers });
    expect(stalePoll.status).toBe(410);
    await expect(stalePoll.json()).resolves.toMatchObject({
      kind: "cursor_too_old",
      minReadableCursor: { graphSeq: 6 },
      recommendedSnapshotId: snapshotBody.snapshotId
    });

    const allowedSubscribe = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:subscribe?from=5`, { headers });
    expect(allowedSubscribe.status).toBe(200);
    await allowedSubscribe.body?.cancel();

    const staleSubscribe = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:subscribe?from=4`, { headers });
    expect(staleSubscribe.status).toBe(410);
    await expect(staleSubscribe.json()).resolves.toMatchObject({
      kind: "cursor_too_old",
      minReadableCursor: { graphSeq: 6 },
      recommendedSnapshotId: snapshotBody.snapshotId
    });

    process.env.NODE_ENV = prevNodeEnv;
    process.env.ENABLE_DEBUG_ENDPOINTS = prevDebugEnabled;
    process.env.MESH_DEBUG_ENDPOINT_TOKEN = prevDebugToken;
  });


  it("logs replay snapshot build telemetry when creating snapshots", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-snapshot-telemetry-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: "S-1", label: "S-1" }) });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: "baseline" }) });
    await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, { method: "POST", headers, body: JSON.stringify({ id: "S-2", label: "S-2" }) });

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const created = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, { method: "POST", headers, body: JSON.stringify({ label: "manual" }) });
    expect(created.status).toBe(200);

    expect(infoSpy).toHaveBeenCalledWith("SNAPSHOT_BUILD", expect.objectContaining({
      buildStrategy: "replay",
      baseCursor: { metaSeq: 0, graphSeq: 0 },
      replayedEventsCount: expect.any(Number)
    }));

    const telemetryCall = infoSpy.mock.calls.find((call) => call[0] === "SNAPSHOT_BUILD");
    const telemetryPayload = telemetryCall?.[1] as { replayedEventsCount?: number; snapshotCursor?: { graphSeq: number } } | undefined;
    expect(telemetryPayload?.replayedEventsCount).toBeGreaterThan(0);
    expect(telemetryPayload?.snapshotCursor?.graphSeq).toBeGreaterThan(0);

    infoSpy.mockRestore();
  });

  it("does not advance minReadable or compact history on snapshot commit", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-snapshot-commit-order-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    for (let idx = 0; idx < 3; idx += 1) {
      await fetch(`${server.url}/v1/${server.graphSpaceId}/graph:nodes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: `C-${idx}`, label: `C-${idx}` })
      });
    }

    const before = await fetch(`${server.url}/v1/${server.graphSpaceId}`, { headers });
    const beforeBody = (await before.json()) as { minReadableCursor: { graphSeq: number } };
    expect(beforeBody.minReadableCursor.graphSeq).toBe(0);

    const snapshot = await fetch(`${server.url}/v1/${server.graphSpaceId}/snapshots:create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "commit-check" })
    });
    expect(snapshot.status).toBe(200);

    const after = await fetch(`${server.url}/v1/${server.graphSpaceId}`, { headers });
    const afterBody = (await after.json()) as { minReadableCursor: { graphSeq: number } };
    expect(afterBody.minReadableCursor.graphSeq).toBe(0);

    const pollFromZero = await fetch(`${server.url}/v1/${server.graphSpaceId}/sync:poll?cursor=${encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 0 }))}`, { headers });
    expect(pollFromZero.status).toBe(200);
    const pollBody = (await pollFromZero.json()) as { graph: Array<{ seq: number }> };
    expect(pollBody.graph.length).toBeGreaterThan(0);
  });

});

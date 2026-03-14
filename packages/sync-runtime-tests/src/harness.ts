import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMeshNotesServer, type MeshNotesServerHandle } from "../../../apps/mesh-notes-server/src/index.js";
import { startReplica as startNotesReplica, type ReplicaHandle } from "../../../apps/mesh-notes-replica/src/index.js";

const DEFAULT_PRINCIPAL = "alice";
const DEFAULT_REPLICA_PRINCIPAL = "replica-client";

export interface ServerHarness {
  handle: MeshNotesServerHandle;
  graphSpaceId: string;
  syncBaseUrl: string;
  principal: string;
  stop: () => Promise<void>;
}

export interface ReplicaHarness {
  handle: ReplicaHandle;
  principal: string;
  stop: () => Promise<void>;
}

export async function startServer(principal = DEFAULT_PRINCIPAL): Promise<ServerHarness> {
  const storageDir = await mkdtemp(join(tmpdir(), "mesh-sync-runtime-tests-"));
  const handle = await startMeshNotesServer({ storageDir, port: 0 });

  return {
    handle,
    graphSpaceId: "notes-app-shared-space-v1",
    syncBaseUrl: handle.syncUrl,
    principal,
    stop: () => handle.close()
  };
}

export async function startReplica(server: ServerHarness, principal = DEFAULT_REPLICA_PRINCIPAL): Promise<ReplicaHarness> {
  const handle = await startNotesReplica({
    baseUrl: server.syncBaseUrl,
    graphSpaceId: server.graphSpaceId,
    principal
  });

  return {
    handle,
    principal,
    stop: () => handle.stopReplica()
  };
}

export async function seedCanonicalEvents(server: ServerHarness): Promise<void> {
  const headers = {
    "content-type": "application/json",
    "x-mesh-principal": server.principal
  };

  const first = await fetch(`${server.handle.url}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "First", body: "Seeded event 1" })
  });
  if (!first.ok) {
    throw new Error(`Unable to seed first canonical event: HTTP ${first.status}`);
  }

  const second = await fetch(`${server.handle.url}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Second", body: "Seeded event 2" })
  });
  if (!second.ok) {
    throw new Error(`Unable to seed second canonical event: HTTP ${second.status}`);
  }

  console.info("[sync-runtime-tests] seeded canonical events", {
    first: await first.json(),
    second: await second.json()
  });
}

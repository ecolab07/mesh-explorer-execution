import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshNotesServer, type MeshNotesServerHandle } from "../../apps/mesh-notes-server/src/index.js";
import { startReplica, type ReplicaHandle } from "../../apps/mesh-notes-replica/src/index.js";

async function eventually(fn: () => Promise<void> | void, options?: { timeoutMs?: number; intervalMs?: number }): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 4_000;
  const intervalMs = options?.intervalMs ?? 40;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await wait(intervalMs);
    }
  }

  throw lastError;
}

describe("Phase 17 app skeleton", { timeout: 30_000 }, () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("CRUD + server restart keeps final state", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-notes-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    let server = await startMeshNotesServer({ storageDir });
    cleanups.push(async () => server.close());

    const cursorFile = join(storageDir, "alice.cursor");
    let replica = await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile });
    cleanups.push(async () => replica.stopReplica());

    const createdA = await createNote(server.url, "alice", "A", "first");
    const createdB = await createNote(server.url, "alice", "B", "second");
    await patchNote(server.url, "alice", createdA, { body: "first-updated" });
    await deleteNote(server.url, "alice", createdB);

    await eventually(() => {
      expect(replica.getState()).toEqual([{ id: createdA, title: "A", body: "first-updated", deleted: false }]);
    });

    await replica.stopReplica();
    await server.close();
    server = await startMeshNotesServer({ storageDir, port: server.port });
    replica = await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile });

    await eventually(async () => {
      const listed = await listNotes(server.url, "alice");
      expect(listed).toEqual([{ id: createdA, title: "A", body: "first-updated", deleted: false }]);
      expect(replica.getState()).toEqual(listed);
    });
  });

  it("replica crash/restart converges", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-notes-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));
    const cursorFile = join(storageDir, "alice.cursor");

    const server = await startMeshNotesServer({ storageDir });
    cleanups.push(async () => server.close());

    let replica = await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile });
    cleanups.push(async () => replica.stopReplica());

    const id1 = await createNote(server.url, "alice", "n1", "b1");
    const id2 = await createNote(server.url, "alice", "n2", "b2");
    await eventually(() => {
      expect(replica.getState().length).toBe(2);
    });

    await replica.stopReplica();

    await patchNote(server.url, "alice", id1, { title: "n1x" });
    await deleteNote(server.url, "alice", id2);

    replica = await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile });

    await eventually(async () => {
      expect(replica.getState()).toEqual(await listNotes(server.url, "alice"));
    });
  });

  it("multi-principal isolation with shared graph space", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-notes-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server = await startMeshNotesServer({ storageDir });
    cleanups.push(async () => server.close());

    const aliceReplica = await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile: join(storageDir, "alice.cursor") });
    const bobReplica = await startReplica({ baseUrl: server.syncUrl, principal: "bob", cursorFile: join(storageDir, "bob.cursor") });
    cleanups.push(async () => aliceReplica.stopReplica());
    cleanups.push(async () => bobReplica.stopReplica());

    const aliceId = await createNote(server.url, "alice", "secret", "for alice");

    await eventually(async () => {
      expect(await listNotes(server.url, "alice")).toEqual([{ id: aliceId, title: "secret", body: "for alice", deleted: false }]);
      expect(await listNotes(server.url, "bob")).toEqual([]);
      expect(aliceReplica.getState()).toEqual([{ id: aliceId, title: "secret", body: "for alice", deleted: false }]);
      expect(bobReplica.getState()).toEqual([]);
      expect(await fetchGraphCursor(server.syncUrl, "bob", bobReplica.getCursor())).toBe(bobReplica.getCursor());
    });
  });
});

async function createNote(baseUrl: string, principal: string, title: string, body: string): Promise<string> {
  const response = await fetch(`${baseUrl}/notes`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ title, body })
  });
  const payload = (await response.json()) as { noteId: string };
  return payload.noteId;
}

async function patchNote(baseUrl: string, principal: string, noteId: string, patch: { title?: string; body?: string }): Promise<void> {
  await fetch(`${baseUrl}/notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    headers: headers(principal),
    body: JSON.stringify(patch)
  });
}

async function deleteNote(baseUrl: string, principal: string, noteId: string): Promise<void> {
  await fetch(`${baseUrl}/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
    headers: headers(principal)
  });
}

async function listNotes(baseUrl: string, principal: string): Promise<Array<{ id: string; title: string; body: string; deleted?: boolean }>> {
  const response = await fetch(`${baseUrl}/notes`, {
    headers: headers(principal)
  });
  const payload = (await response.json()) as { notes: Array<{ id: string; title: string; body: string; deleted?: boolean }> };
  return payload.notes;
}

async function fetchGraphCursor(baseUrl: string, principal: string, cursor: number): Promise<number> {
  const response = await fetch(`${baseUrl}/v1/notes-app-shared-space-v1/sync:pull?from=${cursor}&limitTx=64`, {
    headers: headers(principal)
  });
  const payload = (await response.json()) as { cursorAfterVisible?: number };
  return payload.cursorAfterVisible ?? cursor;
}

function headers(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

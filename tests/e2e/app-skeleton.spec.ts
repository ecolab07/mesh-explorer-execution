import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshNotesServer } from "../../apps/mesh-notes-server/src/index.js";
import { startReplica } from "../../apps/mesh-notes-replica/src/index.js";

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

type Principal = "alice" | "bob" | "carol";
type NoteView = { id: string; title: string; body: string; deleted?: boolean };

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

  it("multi-principal visibility converges with tx-level masking and restart safety", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-notes-phase17-"));
    cleanups.push(async () => rm(storageDir, { recursive: true, force: true }));

    const server = await startMeshNotesServer({ storageDir });
    cleanups.push(async () => server.close());

    const principals: Principal[] = ["alice", "bob", "carol"];
    const cursorFiles = {
      alice: join(storageDir, "alice.cursor"),
      bob: join(storageDir, "bob.cursor"),
      carol: join(storageDir, "carol.cursor")
    };

    const replicas = {
      alice: await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile: cursorFiles.alice }),
      bob: await startReplica({ baseUrl: server.syncUrl, principal: "bob", cursorFile: cursorFiles.bob }),
      carol: await startReplica({ baseUrl: server.syncUrl, principal: "carol", cursorFile: cursorFiles.carol })
    };

    cleanups.push(async () => replicas.alice.stopReplica());
    cleanups.push(async () => replicas.bob.stopReplica());
    cleanups.push(async () => replicas.carol.stopReplica());

    const allVisible = await createNote(server.url, "alice", "shared-1", "all principals", []);
    const bobMasked = await createNote(server.url, "alice", "alice+carol", "hidden from bob", ["bob"]);
    const carolMasked = await createNote(server.url, "alice", "alice+bob", "hidden from carol", ["carol"]);
    const allVisible2 = await createNote(server.url, "alice", "shared-2", "all principals", []);

    const expectedByPrincipal: Record<Principal, NoteView[]> = {
      alice: [
        { id: allVisible, title: "shared-1", body: "all principals", deleted: false },
        { id: bobMasked, title: "alice+carol", body: "hidden from bob", deleted: false },
        { id: carolMasked, title: "alice+bob", body: "hidden from carol", deleted: false },
        { id: allVisible2, title: "shared-2", body: "all principals", deleted: false }
      ],
      bob: [
        { id: allVisible, title: "shared-1", body: "all principals", deleted: false },
        { id: carolMasked, title: "alice+bob", body: "hidden from carol", deleted: false },
        { id: allVisible2, title: "shared-2", body: "all principals", deleted: false }
      ],
      carol: [
        { id: allVisible, title: "shared-1", body: "all principals", deleted: false },
        { id: bobMasked, title: "alice+carol", body: "hidden from bob", deleted: false },
        { id: allVisible2, title: "shared-2", body: "all principals", deleted: false }
      ]
    };

    await eventually(async () => {
      for (const principal of principals) {
        expect(replicas[principal].getState()).toEqual(expectedByPrincipal[principal]);
        expect(await listNotes(server.url, principal)).toEqual(expectedByPrincipal[principal]);
      }
    });

    const cursors = {
      alice: replicas.alice.getCursor(),
      bob: replicas.bob.getCursor(),
      carol: replicas.carol.getCursor()
    };

    expect(cursors).toEqual({ alice: 4, bob: 3, carol: 3 });

    for (const principal of principals) {
      expect(await fetchGraphCursor(server.syncUrl, principal, cursors[principal])).toBe(cursors[principal]);
      expect(await fetchGraphCursor(server.syncUrl, principal, cursors[principal] + 5)).toBe(cursors[principal] + 5);
    }

    const beforeReplay = {
      alice: structuredClone(replicas.alice.getState()),
      bob: structuredClone(replicas.bob.getState()),
      carol: structuredClone(replicas.carol.getState())
    };

    for (const principal of principals) {
      const replay = await fetchPull(server.syncUrl, principal, 0);
      const replayEvents = replay.txBundlesVisible.flatMap((bundle) => bundle.txBundle.graphEvents);
      const before = structuredClone(replicas[principal].getState());
      // duplicate replay must not mutate ongoing incremental state
      expect(replayEvents.length).toBeGreaterThanOrEqual(before.length);
      expect(replicas[principal].getState()).toEqual(before);
      expect(replicas[principal].getState()).toEqual(beforeReplay[principal]);
    }

    await replicas.alice.stopReplica();
    await replicas.bob.stopReplica();
    await replicas.carol.stopReplica();

    const restarted = {
      alice: await startReplica({ baseUrl: server.syncUrl, principal: "alice", cursorFile: cursorFiles.alice }),
      bob: await startReplica({ baseUrl: server.syncUrl, principal: "bob", cursorFile: cursorFiles.bob }),
      carol: await startReplica({ baseUrl: server.syncUrl, principal: "carol", cursorFile: cursorFiles.carol })
    };

    cleanups.push(async () => restarted.alice.stopReplica());
    cleanups.push(async () => restarted.bob.stopReplica());
    cleanups.push(async () => restarted.carol.stopReplica());

    await eventually(async () => {
      for (const principal of principals) {
        expect(restarted[principal].getState()).toEqual(expectedByPrincipal[principal]);
        expect(restarted[principal].getCursor()).toBe(cursors[principal]);
      }
    });

    await writeFile(cursorFiles.bob, await readFile(cursorFiles.alice, "utf8"), "utf8");
    const bobMismatched = await startReplica({ baseUrl: server.syncUrl, principal: "bob", cursorFile: cursorFiles.bob });
    cleanups.push(async () => bobMismatched.stopReplica());

    await eventually(async () => {
      expect(bobMismatched.getState()).toEqual(expectedByPrincipal.bob);
      expect(bobMismatched.getCursor()).toBe(cursors.bob);
    });
  });
});

async function createNote(baseUrl: string, principal: string, title: string, body: string, maskPrincipals?: string[]): Promise<string> {
  const response = await fetch(`${baseUrl}/notes`, {
    method: "POST",
    headers: headers(principal),
    body: JSON.stringify({ title, body, maskPrincipals })
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

async function fetchPull(baseUrl: string, principal: string, cursor: number): Promise<{
  txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }>;
  cursorAfterVisible: number;
}> {
  const response = await fetch(`${baseUrl}/v1/notes-app-shared-space-v1/sync:pull?from=${cursor}&limitTx=64`, {
    headers: headers(principal)
  });
  return (await response.json()) as {
    txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }>;
    cursorAfterVisible: number;
  };
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

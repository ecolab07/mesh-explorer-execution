import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePersistentEventStore } from "@mesh/eventstore-local";
import { createRuntimeLocal } from "../src/index.js";

const roots: string[] = [];

async function makeRootDir(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mesh-runtime-local-${prefix}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("@mesh/runtime-local indexeddb smoke", () => {
  it("starts, executes a minimal command, reads state, and stops cleanly", async () => {
    const previousBackend = process.env.MESH_BACKEND;
    const graphSpaceId = `space-indexeddb-smoke-${randomUUID()}`;
    const dbUri = `indexeddb://mesh_local_v1-${graphSpaceId}`;

    process.env.MESH_BACKEND = "indexeddb";

    try {
      const runtime = await createRuntimeLocal({
        rootDir: await makeRootDir("indexeddb-smoke"),
        graphSpaceId,
        principalId: "principal-indexeddb-smoke"
      });

      await runtime.start();
      const outcome = await runtime.write({
        graphSpaceId,
        commandId: "cmd-indexeddb-smoke-1",
        actorId: "actor-indexeddb-smoke",
        idempotencyKey: "idem-indexeddb-smoke-1",
        payload: { smoke: true }
      });
      expect(outcome.status).toBe("committed");

      const state = await runtime.read();
      expect(state.head.tx).toBe("1");

      await runtime.stop();
    } finally {
      process.env.MESH_BACKEND = previousBackend;
      const store = await makePersistentEventStore(dbUri);
      const deleteDatabase = (store as { deleteDatabase?: () => Promise<void> }).deleteDatabase;
      if (deleteDatabase) {
        await deleteDatabase.call(store);
      }
      await (store as { close: () => Promise<void> }).close();
    }
  });
});

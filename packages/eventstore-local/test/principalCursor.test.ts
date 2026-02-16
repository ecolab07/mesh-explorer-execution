import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore, InMemoryLocalEventStore, type LocalEventStore } from "../src/index.js";

type StoreFactory = () => Promise<{ store: LocalEventStore; cleanup: () => Promise<void> }>;

const createInMemory: StoreFactory = async () => ({
  store: new InMemoryLocalEventStore(),
  cleanup: async () => {
    return;
  }
});

const tempDirs: string[] = [];
const createFileBacked: StoreFactory = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mesh-eventstore-test-"));
  tempDirs.push(dir);
  const store = await FileBackedLocalEventStore.open(path.join(dir, "store.json"));
  return {
    store,
    cleanup: async () => {
      if ("close" in store && typeof store.close === "function") {
        await store.close();
      }
    }
  };
};


const previousVisibilityPolicy = process.env.MESH_TX_VISIBILITY_POLICY;

beforeEach(() => {
  process.env.MESH_TX_VISIBILITY_POLICY = "acl";
});

afterEach(async () => {
  if (previousVisibilityPolicy === undefined) {
    delete process.env.MESH_TX_VISIBILITY_POLICY;
  } else {
    process.env.MESH_TX_VISIBILITY_POLICY = previousVisibilityPolicy;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function appendGraphTx(store: LocalEventStore, graphSpaceId: string, txId: string, payload: Record<string, unknown>) {
  await store.appendTx(
    graphSpaceId,
    { txId, metaEvents: [], graphEvents: [payload] },
    { actorId: "actor-a", idempotencyKey: `idem-${txId}`, payloadHash: `hash-${txId}` }
  );
}

describe.each([
  ["in-memory", createInMemory],
  ["file-backed", createFileBacked]
])("%s principal cursor semantics", (_name, factory) => {
  it("returns monotonic principal cursor deltas", async () => {
    const { store, cleanup } = await factory();
    const graphSpaceId = "space-a";
    try {
      await appendGraphTx(store, graphSpaceId, "tx-1", { value: 1 });
      await appendGraphTx(store, graphSpaceId, "tx-2", { value: 2 });
      await appendGraphTx(store, graphSpaceId, "tx-3", { value: 3 });

      const first = await store.readPrincipalTxRange(graphSpaceId, 0, 10, { principalId: "principal-a" });
      expect(first.txs.map((tx) => tx.txId)).toEqual(["tx-1", "tx-2", "tx-3"]);
      expect(first.cursor).toBe(3);

      const second = await store.readPrincipalTxRange(graphSpaceId, first.cursor, 10, { principalId: "principal-a" });
      expect(second.txs).toEqual([]);
      expect(second.cursor).toBe(3);

      const head = await store.getPrincipalCursorHead(graphSpaceId, { principalId: "principal-a" });
      expect(head).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it("uses principal ordinal cursor semantics under sparse visibility", async () => {
    const { store, cleanup } = await factory();
    const graphSpaceId = "space-b";
    const principal = { principalId: "principal-a" };

    try {
      await appendGraphTx(store, graphSpaceId, "tx-1", { value: 1 });
      await appendGraphTx(store, graphSpaceId, "tx-2", { value: 2, _acl: { "*": "deny" } });
      await appendGraphTx(store, graphSpaceId, "tx-3", { value: 3 });
      await appendGraphTx(store, graphSpaceId, "tx-4", { value: 4, _acl: { "*": "mask" } });
      await appendGraphTx(store, graphSpaceId, "tx-5", { value: 5 });

      const visible = await store.readPrincipalTxRange(graphSpaceId, 0, 10, principal);
      expect(visible.txs.map((tx) => tx.txId)).toEqual(["tx-1", "tx-3", "tx-5"]);
      expect(visible.cursor).toBe(3);

      const fromMiddle = await store.readPrincipalTxRange(graphSpaceId, 1, 10, principal);
      expect(fromMiddle.txs.map((tx) => tx.txId)).toEqual(["tx-3", "tx-5"]);
      expect(fromMiddle.cursor).toBe(3);

      const outOfRange = await store.readPrincipalTxRange(graphSpaceId, 4, 10, principal);
      expect(outOfRange.txs).toEqual([]);
      expect(outOfRange.cursor).toBe(4);
    } finally {
      await cleanup();
    }
  });
});

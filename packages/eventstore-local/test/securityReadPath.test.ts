import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore, InMemoryLocalEventStore, type LocalEventStore } from "../src/index.js";

type StoreFactory = () => Promise<{ store: LocalEventStore; cleanup: () => Promise<void> }>;

const createInMemory: StoreFactory = async () => ({
  store: new InMemoryLocalEventStore(),
  cleanup: async () => undefined
});

const tempDirs: string[] = [];
const createFileBacked: StoreFactory = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mesh-eventstore-security-test-"));
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
  process.env.MESH_TX_VISIBILITY_POLICY = "entity-secret";
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

async function appendGraphTx(store: LocalEventStore, graphSpaceId: string, txId: string, payloads: Array<Record<string, unknown>>) {
  await store.appendTx(
    graphSpaceId,
    { txId, metaEvents: [], graphEvents: payloads },
    { actorId: "actor-a", idempotencyKey: `idem-${txId}`, payloadHash: `hash-${txId}` }
  );
}

describe.each([
  ["in-memory", createInMemory],
  ["file-backed", createFileBacked]
])("%s security read path", (_name, factory) => {
  it("applies strict tx-level masking", async () => {
    const { store, cleanup } = await factory();
    const graphSpaceId = "space-strict-mask";

    try {
      await appendGraphTx(store, graphSpaceId, "tx-1", [{ entityId: "E-public", value: 1 }]);
      await appendGraphTx(store, graphSpaceId, "tx-2", [
        { entityId: "E-secret", value: "hidden-a" },
        { entityId: "E-public", value: "must-not-leak" }
      ]);

      const visible = await store.readPrincipalTxRange(graphSpaceId, 0, 10, { principalId: "user" });
      expect(visible.txs.map((tx) => tx.txId)).toEqual(["tx-1"]);
      expect(visible.txs[0]?.graph).toHaveLength(1);
      expect(visible.cursor).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it("keeps cursor monotone without observable holes", async () => {
    const { store, cleanup } = await factory();
    const graphSpaceId = "space-cursor";

    try {
      await appendGraphTx(store, graphSpaceId, "tx-1", [{ entityId: "E-public", value: 1 }]);
      await appendGraphTx(store, graphSpaceId, "tx-2", [{ entityId: "E-secret", value: 2 }]);
      await appendGraphTx(store, graphSpaceId, "tx-3", [{ entityId: "E-public", value: 3 }]);

      const first = await store.readPrincipalTxRange(graphSpaceId, 0, 1, { principalId: "user" });
      const second = await store.readPrincipalTxRange(graphSpaceId, first.cursor, 1, { principalId: "user" });

      expect(first.txs).toHaveLength(1);
      expect(second.txs).toHaveLength(1);
      expect(first.txs[0]?.txId).toBe("tx-1");
      expect(second.txs[0]?.txId).toBe("tx-3");
      expect(first.txs[0]?.txIndex).toBe(1);
      expect(second.txs[0]?.txIndex).toBe(2);
      expect(first.cursor).toBeLessThan(second.cursor);
      expect(second.cursor).toBe(2);
    } finally {
      await cleanup();
    }
  });

  it("makes masked and absent tx scenarios user-safe indistinguishable", async () => {
    const { store: scenarioA, cleanup: cleanupA } = await factory();
    const { store: scenarioB, cleanup: cleanupB } = await factory();
    const principal = { principalId: "user" };

    try {
      await appendGraphTx(scenarioA, "space-a", "tx-1", [{ entityId: "E-public", value: 1 }]);
      await appendGraphTx(scenarioA, "space-a", "tx-3", [{ entityId: "E-public", value: 3 }]);

      await appendGraphTx(scenarioB, "space-b", "tx-1", [{ entityId: "E-public", value: 1 }]);
      await appendGraphTx(scenarioB, "space-b", "tx-secret", [{ entityId: "E-secret", value: "hidden" }]);
      await appendGraphTx(scenarioB, "space-b", "tx-3", [{ entityId: "E-public", value: 3 }]);

      const observedA = await scenarioA.readPrincipalTxRange("space-a", 0, 10, principal);
      const observedB = await scenarioB.readPrincipalTxRange("space-b", 0, 10, principal);

      const normalize = (value: typeof observedA) => ({
        txs: value.txs.map((tx) => ({
          txId: tx.txId,
          txIndex: tx.txIndex,
          graphPayloads: tx.graph.map((event) => event.payload)
        })),
        cursor: value.cursor,
        shape: {
          hasTxs: Array.isArray(value.txs),
          cursorType: typeof value.cursor
        }
      });

      expect(normalize(observedA)).toEqual(normalize(observedB));
    } finally {
      await cleanupA();
      await cleanupB();
    }
  });
});

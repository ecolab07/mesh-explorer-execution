import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore, InMemoryLocalEventStore, type LocalEventStore } from "../src/index.js";
import { IndexedDbLocalEventStore } from "../src/IndexedDbLocalEventStore.js";
import { getReadCostSnapshotForTests, resetReadCostForTests, type ReadCostSnapshot } from "../src/internal/readCost.js";

type StoreHandle = {
  store: LocalEventStore;
  cleanup: () => Promise<void>;
};

type StoreFactory = () => Promise<StoreHandle>;

const tempDirs: string[] = [];
const indexedDbNames: string[] = [];

const createInMemory: StoreFactory = async () => ({
  store: new InMemoryLocalEventStore(),
  cleanup: async () => {
    return;
  }
});

const createFileBacked: StoreFactory = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mesh-read-cost-"));
  tempDirs.push(dir);
  const store = await FileBackedLocalEventStore.open(path.join(dir, "store.json"));
  return {
    store,
    cleanup: async () => {
      await store.close();
    }
  };
};

const createIndexedDb: StoreFactory = async () => {
  const dbName = `mesh-read-cost-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  indexedDbNames.push(dbName);
  const store = await IndexedDbLocalEventStore.create({ dbName });
  return {
    store,
    cleanup: async () => {
      await store.close();
      await store.deleteDatabase();
    }
  };
};

afterEach(async () => {
  delete process.env.MESH_READ_COST;
  resetReadCostForTests();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }

  while (indexedDbNames.length > 0) {
    const dbName = indexedDbNames.pop();
    if (dbName) {
      const store = await IndexedDbLocalEventStore.create({ dbName });
      await store.deleteDatabase();
    }
  }
});

async function appendDeterministicDataset(store: LocalEventStore, graphSpaceId: string, txCount: number): Promise<void> {
  for (let i = 1; i <= txCount; i += 1) {
    const txId = `tx-${String(i).padStart(6, "0")}`;
    const payload = { value: i };
    await store.appendTx(
      graphSpaceId,
      {
        txId,
        metaEvents: [{ type: "meta", tx: i }],
        graphEvents: [payload, { ...payload, ord: 2 }, { ...payload, ord: 3 }]
      },
      { actorId: "perf", idempotencyKey: `idem-${txId}`, payloadHash: `hash-${txId}` }
    );
  }
}

async function replayGraphTxClosed(store: LocalEventStore, graphSpaceId: string): Promise<ReadCostSnapshot> {
  process.env.MESH_READ_COST = "1";
  resetReadCostForTests();

  let cursor = 0;
  while (true) {
    const batch = await store.readRange(graphSpaceId, "graph", cursor, 2, "TX_CLOSED");
    if (batch.length === 0) {
      break;
    }
    cursor = batch[batch.length - 1].seq;
  }

  return getReadCostSnapshotForTests();
}

async function runScenario(factory: StoreFactory, txCount: number): Promise<ReadCostSnapshot> {
  const graphSpaceId = "perf-space";
  const { store, cleanup } = await factory();
  try {
    await appendDeterministicDataset(store, graphSpaceId, txCount);
    return replayGraphTxClosed(store, graphSpaceId);
  } finally {
    await cleanup();
  }
}

describe.each([
  ["in-memory", createInMemory],
  ["file-backed", createFileBacked],
  ["indexeddb", createIndexedDb]
])("%s read-cost linear scaling", (_name, factory) => {
  it("scales linearly when dataset size doubles", async () => {
    const baseline = await runScenario(factory, 400);
    const doubled = await runScenario(factory, 800);

    expect(baseline.eventsScanned).toBeGreaterThan(0);
    expect(baseline.txIndexLookups).toBeGreaterThan(0);
    expect(baseline.rangeReads).toBeGreaterThan(0);

    expect(doubled.eventsScanned).toBeLessThanOrEqual(Math.ceil(baseline.eventsScanned * 2.5));
    expect(doubled.txIndexLookups).toBeLessThanOrEqual(Math.ceil(baseline.txIndexLookups * 2.5) + 2);
    expect(doubled.rangeReads).toBeLessThanOrEqual(Math.ceil(baseline.rangeReads * 2.5) + 2);
  }, 20000);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { InMemoryLocalEventStore, makePersistentEventStore } from "../../packages/eventstore-local/dist/index.js";

const txCount = Number.parseInt(process.env.MESH_BENCH_TX_COUNT ?? "100", 10);

async function runScenario(name, createStore) {
  const { store, cleanup } = await createStore();
  const graphSpaceId = `bench-${name}`;

  try {
    const appendStart = performance.now();
    for (let i = 1; i <= txCount; i += 1) {
      await store.appendTx(
        graphSpaceId,
        {
          txId: `tx-${i}`,
          metaEvents: [{ i }],
          graphEvents: [{ i, type: "CMD.NOOP" }]
        },
        {
          actorId: "bench-actor",
          idempotencyKey: `idem-${i}`,
          payloadHash: `hash-${i}`
        }
      );
    }
    const appendMs = Number((performance.now() - appendStart).toFixed(3));

    const replayStart = performance.now();
    await store.readRange(graphSpaceId, "meta", 0, Number.MAX_SAFE_INTEGER, "TX_CLOSED");
    await store.readRange(graphSpaceId, "graph", 0, Number.MAX_SAFE_INTEGER, "TX_CLOSED");
    await store.readTxIndex(graphSpaceId);
    const replayMs = Number((performance.now() - replayStart).toFixed(3));

    return { appendMs, replayMs };
  } finally {
    await cleanup();
  }
}

async function createInMemoryStore() {
  return {
    store: new InMemoryLocalEventStore(),
    cleanup: async () => {}
  };
}

async function createFileStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "mesh-bench-file-"));
  const filePath = path.join(dir, "eventstore.json");
  const store = await makePersistentEventStore(filePath);
  return {
    store,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function createIndexedDbStore() {
  const dbUri = "indexeddb://mesh-bench-compare";
  const priming = await makePersistentEventStore(dbUri);
  await priming.deleteDatabase?.();
  const store = await makePersistentEventStore(dbUri);
  return {
    store,
    cleanup: async () => {
      await store.deleteDatabase?.();
    }
  };
}

const result = {
  inmemory: await runScenario("inmemory", createInMemoryStore),
  file: await runScenario("file", createFileStore),
  indexeddb: await runScenario("indexeddb", createIndexedDbStore)
};

console.log(JSON.stringify(result, null, 2));

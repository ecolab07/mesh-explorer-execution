import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { InMemoryLocalEventStore, makePersistentEventStore } from "../../packages/eventstore-local/dist/index.js";
import { KernelMinimalImpl } from "../../packages/kernel-minimal/dist/index.js";
import { PrincipalProjectionEngine } from "../../packages/projection-minimal/dist/index.js";

const SUPPORTED_BACKENDS = ["inmemory", "persistent", "indexeddb"];
const DEFAULT_BACKENDS = ["inmemory", "persistent", "indexeddb"];
const DEFAULT_N = 1000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBackends(value) {
  if (!value || value.trim() === "") {
    return [...DEFAULT_BACKENDS];
  }
  const requested = value
    .split(",")
    .map((backend) => backend.trim().toLowerCase())
    .filter(Boolean);

  const uniqueRequested = [...new Set(requested)];
  const unknown = uniqueRequested.filter((backend) => !SUPPORTED_BACKENDS.includes(backend));
  if (unknown.length > 0) {
    throw new Error(`Unsupported backend(s): ${unknown.join(", ")}`);
  }

  return SUPPORTED_BACKENDS.filter((backend) => uniqueRequested.includes(backend));
}

function hrtimeMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

async function createStoreContext(backend) {
  if (backend === "inmemory") {
    let currentStore = new InMemoryLocalEventStore();
    return {
      store: currentStore,
      reopen: async () => {
        currentStore = new InMemoryLocalEventStore();
        return currentStore;
      },
      cleanup: async () => {}
    };
  }

  if (backend === "persistent") {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mesh-perf-1-persistent-"));
    const filePath = path.join(tempDir, "eventstore.json");
    let currentStore = await makePersistentEventStore(filePath);

    return {
      store: currentStore,
      reopen: async () => {
        currentStore = await makePersistentEventStore(filePath);
        return currentStore;
      },
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      }
    };
  }

  const dbName = `mesh-perf-1-indexeddb`;
  const dbUri = `indexeddb://${dbName}`;
  const primingStore = await makePersistentEventStore(dbUri);
  const primingDelete = primingStore.deleteDatabase;
  if (typeof primingDelete === "function") {
    await primingDelete.call(primingStore);
  }

  let currentStore = await makePersistentEventStore(dbUri);
  return {
    store: currentStore,
    reopen: async () => {
      currentStore = await makePersistentEventStore(dbUri);
      return currentStore;
    },
    cleanup: async () => {
      const deleteDatabase = currentStore.deleteDatabase;
      if (typeof deleteDatabase === "function") {
        await deleteDatabase.call(currentStore);
      }
    }
  };
}

async function runBackendScenario(backend, datasetN) {
  const graphSpaceId = `bench-perf-1-${backend}`;
  const principal = { principalId: "system" };

  const previousBackend = process.env.MESH_BACKEND;
  process.env.MESH_BACKEND = backend;

  const context = await createStoreContext(backend);

  try {
    let store = context.store;
    let kernel = new KernelMinimalImpl(store);
    let projection = new PrincipalProjectionEngine(store, graphSpaceId);

    const appendStart = process.hrtime.bigint();
    for (let i = 1; i <= datasetN; i += 1) {
      const commandId = `perf-1-${backend}-tx-${String(i).padStart(8, "0")}`;
      const outcome = await kernel.execute({
        graphSpaceId,
        commandId,
        actorId: "perf-1-actor",
        idempotencyKey: `perf-1-idem-${String(i).padStart(8, "0")}`,
        payload: { type: "CMD.NOOP", i }
      });
      if (outcome.status !== "committed") {
        throw new Error(`Append failed for backend ${backend} at i=${i}`);
      }
    }
    const appendMs = hrtimeMs(appendStart);

    store = await context.reopen();
    projection = new PrincipalProjectionEngine(store, graphSpaceId);

    const replayStart = process.hrtime.bigint();
    await projection.incremental(principal);
    const replayMs = hrtimeMs(replayStart);

    const projectionStart = process.hrtime.bigint();
    projection.invalidate(graphSpaceId);
    await projection.rebuild(principal);
    const projectionMs = hrtimeMs(projectionStart);

    return {
      appendMs,
      replayMs,
      projectionMs,
      rssBytes: process.memoryUsage().rss
    };
  } finally {
    try {
      await context.cleanup();
    } finally {
      if (previousBackend === undefined) {
        delete process.env.MESH_BACKEND;
      } else {
        process.env.MESH_BACKEND = previousBackend;
      }
    }
  }
}

function resolveCommitHash() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const datasetN = parsePositiveInt(process.env.MESH_BENCH_N, DEFAULT_N);
const backends = parseBackends(process.env.MESH_BENCH_BACKENDS);

const backendResults = {};
for (const backend of backends) {
  backendResults[backend] = await runBackendScenario(backend, datasetN);
}

const output = {
  dataset: { N: datasetN },
  backends: backendResults,
  meta: {
    node: process.version,
    commit: resolveCommitHash()
  }
};

console.log(JSON.stringify(output, null, 2));

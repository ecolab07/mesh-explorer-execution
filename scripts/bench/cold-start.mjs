import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const tempRoot = await mkdtemp(path.join(tmpdir(), "mesh-bench-"));

const nowIso = new Date().toISOString();
const metrics = {
  bench: "cold-start",
  timestamp: nowIso,
  timingsMs: {}
};

try {
  const importStart = performance.now();
  const runtimeLocalModuleUrl = pathToFileURL(
    path.resolve("packages/runtime-local/dist/index.js")
  ).href;
  const runtimeLocalModule = await import(runtimeLocalModuleUrl);
  const importEnd = performance.now();

  const createRuntimeLocal = runtimeLocalModule.createRuntimeLocal;
  if (typeof createRuntimeLocal !== "function") {
    throw new Error("createRuntimeLocal export not found in runtime-local dist build");
  }

  metrics.timingsMs.importRuntimeLocal = Number((importEnd - importStart).toFixed(3));

  const initStart = performance.now();
  const runtime = await createRuntimeLocal({
    rootDir: tempRoot,
    graphSpaceId: "bench-graph",
    principalId: "bench-principal"
  });
  const initEnd = performance.now();
  metrics.timingsMs.createRuntime = Number((initEnd - initStart).toFixed(3));

  const startT0 = performance.now();
  await runtime.start();
  const startT1 = performance.now();
  metrics.timingsMs.start = Number((startT1 - startT0).toFixed(3));

  const readT0 = performance.now();
  const state = await runtime.read();
  const readT1 = performance.now();
  metrics.timingsMs.read = Number((readT1 - readT0).toFixed(3));

  const stopT0 = performance.now();
  await runtime.stop();
  const stopT1 = performance.now();
  metrics.timingsMs.stop = Number((stopT1 - stopT0).toFixed(3));

  metrics.txHead = state.head.tx;
  metrics.started = runtime.status().started;

  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

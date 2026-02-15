import { promises as fs } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRuntimeLocal } from "../dist/index.js";

const rootDir = path.resolve(process.cwd(), ".mesh-runtime-example");
const config = {
  rootDir,
  graphSpaceId: "space-example",
  principalId: "principal-example",
  snapshotPolicy: { minTx: 2 }
};

const command = (idx) => ({
  graphSpaceId: config.graphSpaceId,
  commandId: `example-cmd-${idx}`,
  actorId: "example-actor",
  idempotencyKey: `example-idem-${idx}`,
  payload: { idx }
});

await fs.rm(rootDir, { recursive: true, force: true });

const runtime1 = await createRuntimeLocal(config);
await runtime1.start();
for (let i = 1; i <= 3; i += 1) {
  await runtime1.write(command(i));
}
const state1 = await runtime1.read();
await runtime1.stop();

const runtime2 = await createRuntimeLocal(config);
await runtime2.start();
const state2 = await runtime2.read();
await runtime2.stop();

assert.equal(state2.head.tx, state1.head.tx);
assert.deepEqual(state2.view, state1.view);

console.log("Runtime restart e2e succeeded", {
  head: state2.head.tx,
  nodeCount: state2.view?.nodeCount
});

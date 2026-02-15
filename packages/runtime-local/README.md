# @mesh/runtime-local

`@mesh/runtime-local` is a local persistent runtime for Mesh Explorer.
It assembles:

- `@mesh/kernel-minimal` for command execution
- `@mesh/eventstore-local` for durable event storage
- `@mesh/projection-minimal` for principal projection reads
- `@mesh/snapshot-minimal` for optional startup snapshot maintenance

## Public API

```ts
import { createRuntimeLocal } from "@mesh/runtime-local";

const runtime = await createRuntimeLocal({
  rootDir: "/tmp/mesh-runtime",
  graphSpaceId: "space-1",
  principalId: "principal-1",
  snapshotPolicy: { minTx: 100, intervalMs: 60_000 }
});

await runtime.start();
await runtime.write(command);
const state = await runtime.read();
await runtime.stop();
```

`createRuntimeLocal(config)` returns a runtime with:

- `start()`
- `write(cmd)`
- `read()`
- `stop()`
- `status()`

## Contract

- `read()` is pure: it only reads projection state and does not write snapshots.
- `head.tx` is an opaque string for equality checks (ETag-style semantics).
- Snapshots may be created in `start()` as maintenance, based on `snapshotPolicy`.

## Restart example

Build workspace packages first, then run the runtime-local restart example:

```bash
pnpm -r build
node packages/runtime-local/examples/restart-e2e.mjs
```

The example writes events, restarts the runtime, and verifies head/view stability across restarts.

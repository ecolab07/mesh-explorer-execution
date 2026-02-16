import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRuntimeLocal } from '../../packages/runtime-local/dist/index.js';

const n = Number.parseInt(process.env.MESH_SNAPSHOT_BENCH_N ?? '300', 10);
const count = Number.isFinite(n) && n > 0 ? n : 300;
const rootDir = await mkdtemp(path.join(tmpdir(), 'mesh-snapshot-maint-'));

try {
  const writer = await createRuntimeLocal({ rootDir, graphSpaceId: 'bench-graph', principalId: 'bench-principal' });
  await writer.start();
  for (let i = 1; i <= count; i += 1) {
    await writer.write({
      graphSpaceId: 'bench-graph',
      commandId: `snapshot-bench-${String(i).padStart(6, '0')}`,
      actorId: 'bench-principal',
      idempotencyKey: `snapshot-bench-idem-${String(i).padStart(6, '0')}`,
      payload: { type: 'CMD.NOOP', i }
    });
  }
  await writer.stop();

  const runtime = await createRuntimeLocal({ rootDir, graphSpaceId: 'bench-graph', principalId: 'bench-principal', snapshotPolicy: { minTx: 1 } });
  const t0 = performance.now();
  await runtime.start();
  const t1 = performance.now();
  await runtime.stop();
  console.log(JSON.stringify({ dataset: { N: count }, snapshotMaintenanceMs: Number((t1 - t0).toFixed(3)) }, null, 2));
} catch (error) {
  console.error(`[bench:snapshot-maintenance] ${error.message}`);
  process.exit(1);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

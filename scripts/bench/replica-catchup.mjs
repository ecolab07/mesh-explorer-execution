import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { FileBackedLocalEventStore } from '../../packages/eventstore-local/dist/index.js';
import { KernelMinimalImpl } from '../../packages/kernel-minimal/dist/index.js';
import { LocalSyncHarness } from '../../packages/sync-local/dist/index.js';

const DEFAULT_N = 250;
const parseIntPos = (v, f) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : f;
};

const n = parseIntPos(process.env.MESH_REPLICA_BENCH_N, DEFAULT_N);
const tempDir = await mkdtemp(path.join(tmpdir(), 'mesh-replica-catchup-'));

try {
  const graphSpaceId = 'bench-replica-space';
  const principal = { principalId: 'bench-principal' };
  const store = new FileBackedLocalEventStore(path.join(tempDir, 'events.json'));
  const kernel = new KernelMinimalImpl(store);
  const harness = new LocalSyncHarness(store, graphSpaceId);

  for (let i = 1; i <= n; i += 1) {
    const outcome = await kernel.execute({
      graphSpaceId,
      commandId: `replica-catchup-${String(i).padStart(6, '0')}`,
      actorId: 'bench-principal',
      idempotencyKey: `replica-catchup-idem-${String(i).padStart(6, '0')}`,
      payload: { type: 'CMD.NOOP', i }
    });
    if (outcome.status !== 'committed') throw new Error(`Write failed at i=${i}`);
  }

  let cursor = 0;
  let seen = 0;
  const t0 = performance.now();
  while (seen < n) {
    const pulled = await harness.poll(principal, cursor, 64);
    if (pulled.principalCursorAfter === cursor) break;
    seen += pulled.txIds.length;
    cursor = pulled.principalCursorAfter;
  }
  const t1 = performance.now();

  console.log(JSON.stringify({ dataset: { N: n }, replicaCatchupMs: Number((t1 - t0).toFixed(3)), principalCursorAfter: cursor, txSeen: seen }, null, 2));
} catch (error) {
  console.error(`[bench:replica-catchup] ${error.message}`);
  process.exit(1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

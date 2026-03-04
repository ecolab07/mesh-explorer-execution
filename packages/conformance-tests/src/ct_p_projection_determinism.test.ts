import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import type { TxBundle } from "@mesh/shared";
import { PrincipalProjectionEngine, type ProjectionSnapshot } from "@mesh/projection-minimal";
import { FileBackedSnapshotStore, InMemorySnapshotStore, type SnapshotStore } from "@mesh/snapshot-minimal";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { assertProjectionDeterminism, projectionEvidence } from "./projectionDeterminismHarness.js";

type StoreScope = {
  store: LocalEventStore;
  reopen: () => Promise<LocalEventStore>;
  cleanup: () => Promise<void>;
};

const BACKENDS = getConformanceBackends().filter((backend): backend is ConformanceBackend => backend !== "indexeddb");

const principal = { principalId: "alice" };

function fixtureTxs(prefix: string, count = 12): TxBundle[] {
  return Array.from({ length: count }, (_, idx) => {
    const n = idx + 1;
    return {
      txId: `${prefix}-tx-${n}`,
      metaEvents: [{ type: "meta", i: n }],
      graphEvents: [{ id: `node-${n}`, kind: n % 2 === 0 ? "even" : "odd", weight: n }]
    };
  });
}

async function appendTxs(store: LocalEventStore, graphSpaceId: string, txs: TxBundle[], idPrefix: string): Promise<void> {
  for (let idx = 0; idx < txs.length; idx += 1) {
    await store.appendTx(
      graphSpaceId,
      txs[idx],
      { actorId: "actor", idempotencyKey: `${idPrefix}-k-${idx}`, payloadHash: `${idPrefix}-h-${idx}` }
    );
  }
}

function chunkPlan(length: number, seed: number): number[] {
  const chunks: number[] = [];
  let remaining = length;
  let state = seed;

  while (remaining > 0) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const next = (state % 4) + 1;
    const chunkSize = Math.min(next, remaining);
    chunks.push(chunkSize);
    remaining -= chunkSize;
  }

  return chunks;
}

describe.each(BACKENDS)("CT-PROJ-DET-* (%s)", (backend) => {
  let scope: StoreScope;
  let snapshotDir: string | null = null;

  beforeEach(async () => {
    scope = await makeStore(backend);
  });

  afterEach(async () => {
    await scope.cleanup();
    if (snapshotDir) {
      await fs.rm(snapshotDir, { recursive: true, force: true });
      snapshotDir = null;
    }
  });

  it("[INV:CT-PROJ-DET-1][SURF:Projection] CT-PROJ-DET-1 full replay twice yields same digest", async ({ task }) => {
    task.meta.invariantId = "CT-PROJ-DET-1";
    task.meta.surface = "Projection";
    task.meta.oracle = "Replaying the same visible log twice yields identical projection digest at equal cursor.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-proj-det-1-${backend}`;
    const txs = fixtureTxs("det1");
    await appendTxs(scope.store, graphSpaceId, txs, "det1-seed");

    const engineA = new PrincipalProjectionEngine(scope.store, graphSpaceId);
    const first = await engineA.rebuild(principal);

    const engineB = new PrincipalProjectionEngine(scope.store, graphSpaceId);
    const second = await engineB.rebuild(principal);

    const firstEvidence = projectionEvidence("full-replay-1", first);
    const secondEvidence = projectionEvidence("full-replay-2", second);

    expect(firstEvidence.cursor).toBe(secondEvidence.cursor);
    assertProjectionDeterminism(firstEvidence, secondEvidence);
  });

  it("[INV:CT-PROJ-DET-2][SURF:Projection] CT-PROJ-DET-2 chunked replay is digest-stable", async ({ task }) => {
    task.meta.invariantId = "CT-PROJ-DET-2";
    task.meta.surface = "Projection";
    task.meta.oracle = "Equivalent replay under variable chunking converges to same digest and cursor.";
    task.meta.criticality = "Critical";

    const baseSpaceId = `space-proj-det-2-base-${backend}`;
    const chunkedSpaceId = `space-proj-det-2-chunk-${backend}`;
    const txs = fixtureTxs("det2", 15);

    await appendTxs(scope.store, baseSpaceId, txs, "det2-base");
    const baseEngine = new PrincipalProjectionEngine(scope.store, baseSpaceId);
    const baseline = await baseEngine.rebuild(principal);

    const chunkSizes = chunkPlan(txs.length, 42);
    const chunkEngine = new PrincipalProjectionEngine(scope.store, chunkedSpaceId);
    let offset = 0;
    for (const size of chunkSizes) {
      const slice = txs.slice(offset, offset + size);
      await appendTxs(scope.store, chunkedSpaceId, slice, `det2-chunk-${offset}`);
      await chunkEngine.incremental(principal);
      offset += size;
    }

    const chunkedFinal = await chunkEngine.incremental(principal);
    const baselineEvidence = projectionEvidence("baseline-full", baseline);
    const chunkedEvidence = projectionEvidence("chunked-incremental", chunkedFinal);

    expect(chunkedEvidence.cursor).toBe(baselineEvidence.cursor);
    assertProjectionDeterminism(baselineEvidence, chunkedEvidence);
  });

  it("[INV:CT-PROJ-DET-3][SURF:Projection] CT-PROJ-DET-3 restart stability at fixed cursor", async ({ task }) => {
    task.meta.invariantId = "CT-PROJ-DET-3";
    task.meta.surface = "Projection";
    task.meta.oracle = "Restart does not alter projection digest when cursor is unchanged.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-proj-det-3-${backend}`;
    const txs = fixtureTxs("det3", 10);
    await appendTxs(scope.store, graphSpaceId, txs, "det3-seed");

    const beforeEngine = new PrincipalProjectionEngine(scope.store, graphSpaceId);
    const beforeRestart = await beforeEngine.rebuild(principal);

    let restartedStore: LocalEventStore;
    if (backend === "persistent") {
      restartedStore = await scope.reopen();
    } else {
      restartedStore = new InMemoryLocalEventStore();
      await appendTxs(restartedStore, graphSpaceId, txs, "det3-replay");
    }

    const afterEngine = new PrincipalProjectionEngine(restartedStore, graphSpaceId);
    const afterRestart = await afterEngine.rebuild(principal);

    const beforeEvidence = projectionEvidence("before-restart", beforeRestart);
    const afterEvidence = projectionEvidence("after-restart", afterRestart);

    expect(afterEvidence.cursor).toBe(beforeEvidence.cursor);
    assertProjectionDeterminism(beforeEvidence, afterEvidence);
  });

  it("[INV:CT-PROJ-DET-4][SURF:Projection] CT-PROJ-DET-4 snapshot restore remains deterministic", async ({ task }) => {
    task.meta.invariantId = "CT-PROJ-DET-4";
    task.meta.surface = "Projection";
    task.meta.oracle = "Snapshot restore + replay-to-quiescence yields same digest as full rebuild at same cursor.";
    task.meta.criticality = "Critical";

    const graphSpaceId = `space-proj-det-4-${backend}`;
    const txs = fixtureTxs("det4", 20);
    await appendTxs(scope.store, graphSpaceId, txs, "det4-seed");

    let snapshotStore: SnapshotStore<ProjectionSnapshot>;
    if (backend === "persistent") {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-proj-det-snap-"));
      snapshotDir = dir;
      const snapshotFile = path.join(dir, "snapshots.json");
      snapshotStore = new FileBackedSnapshotStore(snapshotFile);
    } else {
      snapshotStore = new InMemorySnapshotStore();
    }

    const fullEngine = new PrincipalProjectionEngine(scope.store, graphSpaceId);
    const baseline = await fullEngine.rebuild(principal);

    const withSnapshotFirst = await fullEngine.rebuildWithSnapshot({ principal, snapshotStore });
    const withSnapshotSecond = await fullEngine.rebuildWithSnapshot({ principal, snapshotStore });

    const baselineEvidence = projectionEvidence("baseline-full", baseline);
    const firstEvidence = projectionEvidence("snapshot-first", withSnapshotFirst.snapshot);
    const secondEvidence = projectionEvidence("snapshot-restore", withSnapshotSecond.snapshot);

    expect(firstEvidence.cursor).toBe(baselineEvidence.cursor);
    expect(secondEvidence.cursor).toBe(baselineEvidence.cursor);
    assertProjectionDeterminism(baselineEvidence, firstEvidence);
    assertProjectionDeterminism(baselineEvidence, secondEvidence);
  });
});

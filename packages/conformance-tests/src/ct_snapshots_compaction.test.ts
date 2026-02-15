import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { REASON_CODES } from "@mesh/shared";
import { PrincipalProjectionEngine, type ProjectionSnapshot } from "@mesh/projection-minimal";
import {
  FileBackedSnapshotStore,
  InMemorySnapshotStore,
  SNAPSHOT_VERSION_V1,
  SnapshotValidationError,
  type SnapshotStore
} from "@mesh/snapshot-minimal";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type StoreScope = {
  store: LocalEventStore;
  reopen: () => Promise<LocalEventStore>;
  cleanup: () => Promise<void>;
};

describe.each(getConformanceBackends())("CT-SNAP/COMP-* (%s)", (backend: ConformanceBackend) => {
  let scope: StoreScope;
  let snapshotStore: SnapshotStore<ProjectionSnapshot>;
  let snapshotDir: string | null = null;

  beforeEach(async () => {
    scope = await makeStore(backend);
    if (backend === "persistent") {
      snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-snapshot-store-"));
      snapshotStore = new FileBackedSnapshotStore(path.join(snapshotDir, "snapshots.json"));
      return;
    }
    snapshotStore = new InMemorySnapshotStore();
  });

  afterEach(async () => {
    await scope.cleanup();
    if (snapshotDir) {
      await fs.rm(snapshotDir, { recursive: true, force: true });
    }
  });

  it("[INV:CT-SNAP-1][SURF:Snapshot] CT-SNAP-1 snapshot rebuild equivalence", async ({ task }) => {
    task.meta.invariantId = "CT-SNAP-1";
    task.meta.surface = "Snapshot";
    task.meta.oracle = "Full projection rebuild equals rebuildWithSnapshot for identical principal state and cursor.";
    task.meta.criticality = "Structural";

    const graphSpaceId = "space-snap-1";
    const principal = { principalId: "alice" };
    const engine = new PrincipalProjectionEngine(scope.store, graphSpaceId);

    await scope.store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, { actorId: "actor", idempotencyKey: "snap-1-k1", payloadHash: "snap-1-h1" });
    await scope.store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, { actorId: "actor", idempotencyKey: "snap-1-k2", payloadHash: "snap-1-h2" });

    const full = await engine.rebuild(principal);
    const withSnapshot = await engine.rebuildWithSnapshot({ principal, snapshotStore });

    expect(withSnapshot.snapshot).toEqual(full);
    expect(withSnapshot.snapshot.cursor).toEqual(full.cursor);
  });

  it("[INV:CT-SNAP-2][SURF:Snapshot] CT-SNAP-2 snapshot determinism + versioning", async ({ task }) => {
    task.meta.invariantId = "CT-SNAP-2";
    task.meta.surface = "Snapshot";
    task.meta.oracle = "Snapshot version is stable at V1 and unsupported versions fail with VALIDATION/UNSUPPORTED_SNAPSHOT_VERSION.";
    task.meta.criticality = "Regression";

    const graphSpaceId = "space-snap-2";
    const principal = { principalId: "alice" };
    const engine = new PrincipalProjectionEngine(scope.store, graphSpaceId);

    await scope.store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, { actorId: "actor", idempotencyKey: "snap-2-k1", payloadHash: "snap-2-h1" });
    const first = await engine.rebuildWithSnapshot({ principal, snapshotStore });
    const loaded = await snapshotStore.loadLatestSnapshot({ graphSpaceId, principalId: principal.principalId });

    expect(first.snapshot).toEqual(loaded?.payload);
    expect(loaded?.snapshotVersion).toBe(SNAPSHOT_VERSION_V1);

    await expect(
      snapshotStore.saveSnapshot({
        snapshotId: "invalid-version",
        snapshotVersion: 999,
        graphSpaceId,
        principalId: principal.principalId,
        cursorAt: 1,
        payload: first.snapshot
      })
    ).rejects.toMatchObject({ category: "VALIDATION", reasonCode: REASON_CODES.UNSUPPORTED_SNAPSHOT_VERSION });

    await expect(
      snapshotStore.saveSnapshot({
        snapshotId: "invalid-version",
        snapshotVersion: 999,
        graphSpaceId,
        principalId: principal.principalId,
        cursorAt: 1,
        payload: first.snapshot
      })
    ).rejects.toBeInstanceOf(SnapshotValidationError);
  });

  it("[INV:CT-SNAP-3][SURF:Snapshot] CT-SNAP-3 snapshot reduces replay work", async ({ task }) => {
    task.meta.invariantId = "CT-SNAP-3";
    task.meta.surface = "Snapshot";
    task.meta.oracle = "With a prior snapshot at threshold N, rebuildWithSnapshot replays fewer tx than full rebuild.";
    task.meta.criticality = "Structural";

    const graphSpaceId = "space-snap-3";
    const principal = { principalId: "alice" };
    const engine = new PrincipalProjectionEngine(scope.store, graphSpaceId);

    for (let idx = 1; idx <= 8; idx += 1) {
      await scope.store.appendTx(
        graphSpaceId,
        { txId: `tx-${idx}`, metaEvents: [], graphEvents: [{ n: idx }] },
        { actorId: "actor", idempotencyKey: `snap-3-k${idx}`, payloadHash: `snap-3-h${idx}` }
      );
    }

    await engine.rebuildWithSnapshot({ principal, snapshotStore });

    for (let idx = 9; idx <= 12; idx += 1) {
      await scope.store.appendTx(
        graphSpaceId,
        { txId: `tx-${idx}`, metaEvents: [], graphEvents: [{ n: idx }] },
        { actorId: "actor", idempotencyKey: `snap-3-k${idx}`, payloadHash: `snap-3-h${idx}` }
      );
    }

    const full = await engine.rebuild(principal);
    const withSnapshot = await engine.rebuildWithSnapshot({ principal, snapshotStore });

    expect(full).toEqual(withSnapshot.snapshot);
    expect(withSnapshot.replayStats.appliedTxCount).toBeLessThan(12);
    expect(withSnapshot.replayStats.appliedTxCount).toBeLessThan(8);
  });

  it("[INV:CT-COMP-1][SURF:Compaction] CT-COMP-1 compaction safety", async ({ task }) => {
    task.meta.invariantId = "CT-COMP-1";
    task.meta.surface = "Compaction";
    task.meta.oracle = "Compacting tx below a durable snapshot cursor preserves final projection state after snapshot+replay rebuild.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-comp-1";
    const principal = { principalId: "alice" };
    const engine = new PrincipalProjectionEngine(scope.store, graphSpaceId);

    for (let idx = 1; idx <= 5; idx += 1) {
      await scope.store.appendTx(
        graphSpaceId,
        { txId: `tx-c1-${idx}`, metaEvents: [], graphEvents: [{ n: idx }] },
        { actorId: "actor", idempotencyKey: `comp-1-k${idx}`, payloadHash: `comp-1-h${idx}` }
      );
    }

    const before = await engine.rebuildWithSnapshot({ principal, snapshotStore });
    await scope.store.compactUpToCursor({ graphSpaceId, cursorExclusive: before.snapshot.cursor + 1 });

    const after = await engine.rebuildWithSnapshot({ principal, snapshotStore });
    expect(after.snapshot).toEqual(before.snapshot);
  });

  it("[INV:CT-COMP-2][SURF:Compaction] CT-COMP-2 compaction does not break idempotency", async ({ task }) => {
    task.meta.invariantId = "CT-COMP-2";
    task.meta.surface = "Compaction";
    task.meta.oracle = "Compacting historical tx does not break idempotent re-submission semantics for compacted tx ids.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-comp-2";
    const txBundle = { txId: "tx-idem", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }] };
    const idem = { actorId: "actor", idempotencyKey: "comp-2-k1", payloadHash: "comp-2-h1" };

    const first = await scope.store.appendTx(graphSpaceId, txBundle, idem);
    expect(first).toMatchObject({ status: "committed", txId: "tx-idem" });

    await scope.store.compactUpToCursor({ graphSpaceId, cursorExclusive: 2 });
    const replay = await scope.store.appendTx(graphSpaceId, txBundle, idem);

    expect(replay).toEqual(first);
  });
});

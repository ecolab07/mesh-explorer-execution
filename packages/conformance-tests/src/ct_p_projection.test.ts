import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

// Invariant: incremental projection and full rebuild converge to identical final snapshot; fail on any snapshot field mismatch.
// Invariant: projection cache is scoped by principal (no cross-principal tx bleed); fail if txIds/cursor leak between users.
// Invariant: new committed tx invalidates previous observable state after apply/poll cycle; fail if state remains stale.
describe("CT-P-* Projection determinism", () => {
  it("[INV:CT-P-1][SURF:Projection] CT-P-1: incremental apply equals rebuild", async ({ task }) => {
    task.meta.invariantId = "CT-P-1";
    task.meta.surface = "Projection";
    task.meta.oracle = "Incremental projection from cursor must equal full rebuild snapshot for same principal.";
    task.meta.criticality = "Structural";
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-p1";
    const engine = new PrincipalProjectionEngine(store, graphSpaceId);
    const principal = { principalId: "alice" };

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, { actorId: "actor", idempotencyKey: "p1-k1", payloadHash: "p1-h1" });
    await engine.incremental(principal);

    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, { actorId: "actor", idempotencyKey: "p1-k2", payloadHash: "p1-h2" });
    const incremental = await engine.incremental(principal);
    const rebuilt = await engine.rebuild(principal);

    expect(incremental).toEqual({ principalId: "alice", cursor: 2, nodeCount: 2, txIds: ["tx-1", "tx-2"] });
    expect(incremental).toEqual(rebuilt);
  });

  it("[INV:CT-P-2][SURF:Projection] CT-P-2: cache is scoped by principal", async ({ task }) => {
    task.meta.invariantId = "CT-P-2";
    task.meta.surface = "Projection";
    task.meta.oracle = "Projection cache keys are principal-scoped; different principals cannot observe cached snapshots interchangeably.";
    task.meta.criticality = "Structural";
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-p2";
    const engine = new PrincipalProjectionEngine(store, graphSpaceId);

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1, _acl: { bob: "deny" } }] }, { actorId: "actor", idempotencyKey: "p2-k1", payloadHash: "p2-h1" });

    const aliceV1 = await engine.incremental({ principalId: "alice" });
    const bobV1 = await engine.incremental({ principalId: "bob" });

    expect(aliceV1).toEqual({ principalId: "alice", cursor: 1, nodeCount: 1, txIds: ["tx-1"] });
    expect(bobV1).toEqual({ principalId: "bob", cursor: 0, nodeCount: 0, txIds: [] });
    expect(aliceV1).not.toEqual(bobV1);
  });

  it("[INV:CT-P-3][SURF:Projection] CT-P-3: invalidation + new tx changes snapshot after incremental apply", async ({ task }) => {
    task.meta.invariantId = "CT-P-3";
    task.meta.surface = "Projection";
    task.meta.oracle = "After invalidation and new tx, incremental apply must produce updated snapshot and advanced cursor.";
    task.meta.criticality = "Regression";
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-p3";
    const engine = new PrincipalProjectionEngine(store, graphSpaceId);
    const principal = { principalId: "alice" };

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, { actorId: "actor", idempotencyKey: "p3-k1", payloadHash: "p3-h1" });
    const before = await engine.incremental(principal);

    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, { actorId: "actor", idempotencyKey: "p3-k2", payloadHash: "p3-h2" });
    engine.invalidate(graphSpaceId);
    const after = await engine.incremental(principal);

    expect(before).toEqual({ principalId: "alice", cursor: 1, nodeCount: 1, txIds: ["tx-1"] });
    expect(after).toEqual({ principalId: "alice", cursor: 2, nodeCount: 2, txIds: ["tx-1", "tx-2"] });
  });
});

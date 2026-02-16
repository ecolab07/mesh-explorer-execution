import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

const VISIBILITY_POLICY_ENV = "MESH_TX_VISIBILITY_POLICY";

function withVisibilityPolicy<T>(policy: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[VISIBILITY_POLICY_ENV];
  process.env[VISIBILITY_POLICY_ENV] = policy;
  return run().finally(() => {
    if (previous === undefined) {
      delete process.env[VISIBILITY_POLICY_ENV];
    } else {
      process.env[VISIBILITY_POLICY_ENV] = previous;
    }
  });
}

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

    expect(incremental).toEqual({ principalId: "alice", cursor: 2, nodeCount: 2, txIds: ["placeholder", "placeholder"] });
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

    expect(aliceV1).toEqual({ principalId: "alice", cursor: 1, nodeCount: 1, txIds: ["placeholder"] });
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

    expect(before).toEqual({ principalId: "alice", cursor: 1, nodeCount: 1, txIds: ["placeholder"] });
    expect(after).toEqual({ principalId: "alice", cursor: 2, nodeCount: 2, txIds: ["placeholder", "placeholder"] });
  });

  it("[INV:CT-P-SEC-1][SURF:Projection] CT-P-SEC-1: masked entities become non-revealing placeholders", async ({ task }) => {
    task.meta.invariantId = "CT-P-SEC-1";
    task.meta.surface = "Projection";
    task.meta.oracle = "Projection output for user-safe reads never leaks canonical tx identifiers and remains stable placeholder-only.";
    task.meta.criticality = "Structural";

    await withVisibilityPolicy("acl", async () => {
      const store = new InMemoryLocalEventStore();
      const graphSpaceId = "space-p-sec-1";
      const engine = new PrincipalProjectionEngine(store, graphSpaceId);

      await store.appendTx(
        graphSpaceId,
        { txId: "tx-public", metaEvents: [], graphEvents: [{ n: 1 }] },
        { actorId: "actor", idempotencyKey: "psec1-k1", payloadHash: "psec1-h1" }
      );
      await store.appendTx(
        graphSpaceId,
        { txId: "tx-secret", metaEvents: [], graphEvents: [{ n: 2, _acl: { user: "deny" } }] },
        { actorId: "actor", idempotencyKey: "psec1-k2", payloadHash: "psec1-h2" }
      );

      const userView = await engine.rebuild({ principalId: "user" });

      expect(userView.txIds).toEqual(["placeholder"]);
      expect(userView.txIds).not.toContain("tx-public");
      expect(userView.txIds).not.toContain("tx-secret");
      expect(userView.nodeCount).toBe(1);
    });
  });

  it("[INV:CT-P-SEC-2][SURF:Projection] CT-P-SEC-2: derived view fields mask hidden dependencies", async ({ task }) => {
    task.meta.invariantId = "CT-P-SEC-2";
    task.meta.surface = "Projection";
    task.meta.oracle = "Derived fields (nodeCount) must be computed only from user-visible txs and never from hidden dependencies.";
    task.meta.criticality = "Structural";

    await withVisibilityPolicy("entity-secret", async () => {
      const store = new InMemoryLocalEventStore();
      const graphSpaceId = "space-p-sec-2";
      const engine = new PrincipalProjectionEngine(store, graphSpaceId);

      await store.appendTx(
        graphSpaceId,
        { txId: "tx-public", metaEvents: [], graphEvents: [{ entityId: "E-public", n: 1 }] },
        { actorId: "actor", idempotencyKey: "psec2-k1", payloadHash: "psec2-h1" }
      );
      await store.appendTx(
        graphSpaceId,
        { txId: "tx-secret", metaEvents: [], graphEvents: [{ entityId: "E-secret", n: 2 }] },
        { actorId: "actor", idempotencyKey: "psec2-k2", payloadHash: "psec2-h2" }
      );

      const userView = await engine.rebuild({ principalId: "user" });
      expect(userView.nodeCount).toBe(1);
      expect(userView.txIds).toEqual(["placeholder"]);
    });
  });

  it("[INV:CT-P-SEC-3][SURF:Projection] CT-P-SEC-3: absent and masked are indistinguishable in projection output", async ({ task }) => {
    task.meta.invariantId = "CT-P-SEC-3";
    task.meta.surface = "Projection";
    task.meta.oracle = "User-safe projection output shape must match between truly absent entities and present-but-masked entities.";
    task.meta.criticality = "Structural";

    await withVisibilityPolicy("entity-secret", async () => {
      const storeA = new InMemoryLocalEventStore();
      const storeB = new InMemoryLocalEventStore();
      const principal = { principalId: "user" };

      await storeA.appendTx(
        "space-a",
        { txId: "tx-1", metaEvents: [], graphEvents: [{ entityId: "E-public", n: 1 }] },
        { actorId: "actor", idempotencyKey: "psec3-a-k1", payloadHash: "psec3-a-h1" }
      );
      await storeA.appendTx(
        "space-a",
        { txId: "tx-3", metaEvents: [], graphEvents: [{ entityId: "E-public", n: 3 }] },
        { actorId: "actor", idempotencyKey: "psec3-a-k3", payloadHash: "psec3-a-h3" }
      );

      await storeB.appendTx(
        "space-b",
        { txId: "tx-1", metaEvents: [], graphEvents: [{ entityId: "E-public", n: 1 }] },
        { actorId: "actor", idempotencyKey: "psec3-b-k1", payloadHash: "psec3-b-h1" }
      );
      await storeB.appendTx(
        "space-b",
        { txId: "tx-secret", metaEvents: [], graphEvents: [{ entityId: "E-secret", n: 2 }] },
        { actorId: "actor", idempotencyKey: "psec3-b-k2", payloadHash: "psec3-b-h2" }
      );
      await storeB.appendTx(
        "space-b",
        { txId: "tx-3", metaEvents: [], graphEvents: [{ entityId: "E-public", n: 3 }] },
        { actorId: "actor", idempotencyKey: "psec3-b-k3", payloadHash: "psec3-b-h3" }
      );

      const engineA = new PrincipalProjectionEngine(storeA, "space-a");
      const engineB = new PrincipalProjectionEngine(storeB, "space-b");

      const viewA = await engineA.rebuild(principal);
      const viewB = await engineB.rebuild(principal);

      const normalize = (view: typeof viewA) => ({
        cursor: view.cursor,
        nodeCount: view.nodeCount,
        txShape: view.txIds.map((id) => id)
      });

      expect(normalize(viewA)).toEqual(normalize(viewB));
    });
  });

  it("[INV:CT-P-SEC-4][SURF:Projection] CT-P-SEC-4: caches never contaminate across principals", async ({ task }) => {
    task.meta.invariantId = "CT-P-SEC-4";
    task.meta.surface = "Projection";
    task.meta.oracle = "Admin cache warm-up must not leak privileged tx material to user-safe projection reads.";
    task.meta.criticality = "Critical";

    await withVisibilityPolicy("acl", async () => {
      const store = new InMemoryLocalEventStore();
      const graphSpaceId = "space-p-sec-4";
      const engine = new PrincipalProjectionEngine(store, graphSpaceId);

      await store.appendTx(
        graphSpaceId,
        { txId: "tx-public", metaEvents: [], graphEvents: [{ n: 1 }] },
        { actorId: "actor", idempotencyKey: "psec4-k1", payloadHash: "psec4-h1" }
      );
      await store.appendTx(
        graphSpaceId,
        { txId: "tx-secret", metaEvents: [], graphEvents: [{ n: 2, _acl: { user: "deny" } }] },
        { actorId: "actor", idempotencyKey: "psec4-k2", payloadHash: "psec4-h2" }
      );

      const admin = await engine.rebuild({ principalId: "admin" });
      const user = await engine.incremental({ principalId: "user" });

      expect(admin).toEqual({ principalId: "admin", cursor: 2, nodeCount: 2, txIds: ["placeholder", "placeholder"] });
      expect(user).toEqual({ principalId: "user", cursor: 1, nodeCount: 1, txIds: ["placeholder"] });
    });
  });
});

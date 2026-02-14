import { describe, expect, it } from "vitest";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

describe("CT-P-* Projection determinism", () => {
  it("CT-P-1: incremental apply equals rebuild", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-p1";
    const engine = new PrincipalProjectionEngine(store, graphSpaceId);
    const principal = { principalId: "alice" };

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1 }] }, { actorId: "actor", idempotencyKey: "p1-k1", payloadHash: "p1-h1" });
    await engine.incremental(principal);

    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, { actorId: "actor", idempotencyKey: "p1-k2", payloadHash: "p1-h2" });
    const incremental = await engine.incremental(principal);
    const rebuilt = await engine.rebuild(principal);

    expect(incremental).toEqual(rebuilt);
  });

  it("CT-P-2: cache is scoped by principal and invalidates on new tx", async () => {
    const store = new InMemoryLocalEventStore();
    const graphSpaceId = "space-p2";
    const engine = new PrincipalProjectionEngine(store, graphSpaceId);

    await store.appendTx(graphSpaceId, { txId: "tx-1", metaEvents: [], graphEvents: [{ n: 1, _acl: { bob: "deny" } }] }, { actorId: "actor", idempotencyKey: "p2-k1", payloadHash: "p2-h1" });

    const aliceV1 = await engine.incremental({ principalId: "alice" });
    const bobV1 = await engine.incremental({ principalId: "bob" });
    expect(aliceV1.txIds).toEqual(["tx-1"]);
    expect(bobV1.txIds).toEqual([]);

    await store.appendTx(graphSpaceId, { txId: "tx-2", metaEvents: [], graphEvents: [{ n: 2 }] }, { actorId: "actor", idempotencyKey: "p2-k2", payloadHash: "p2-h2" });
    engine.invalidate(graphSpaceId);

    const aliceV2 = await engine.incremental({ principalId: "alice" });
    const bobV2 = await engine.incremental({ principalId: "bob" });
    expect(aliceV2.txIds).toEqual(["tx-1", "tx-2"]);
    expect(bobV2.txIds).toEqual(["tx-2"]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { makePersistentEventStore, type LocalEventStore } from "@mesh/eventstore-local";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

const VISIBILITY_POLICY_ENV = "MESH_TX_VISIBILITY_POLICY";

async function withAclPolicy<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[VISIBILITY_POLICY_ENV];
  process.env[VISIBILITY_POLICY_ENV] = "acl";
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[VISIBILITY_POLICY_ENV];
    } else {
      process.env[VISIBILITY_POLICY_ENV] = previous;
    }
  }
}

describe("security validation explicitly on indexeddb backend", () => {
  let cleanup: undefined | (() => Promise<void>);

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("enforces acl tx masking, monotone cursor, non-revealing placeholders, and cache scoping", async () => {
    await withAclPolicy(async () => {
      const graphSpaceId = "space-sec-indexeddb-acl";
      const dbUri = `indexeddb://mesh-security-${graphSpaceId}`;

      const primingStore = (await makePersistentEventStore(dbUri)) as LocalEventStore & { deleteDatabase?: () => Promise<void> };
      await primingStore.deleteDatabase?.();

      const store = (await makePersistentEventStore(dbUri)) as LocalEventStore & { deleteDatabase?: () => Promise<void> };
      cleanup = async () => {
        await store.deleteDatabase?.();
      };

      expect(typeof store.deleteDatabase).toBe("function");

      await store.appendTx(
        graphSpaceId,
        { txId: "tx-public-1", metaEvents: [], graphEvents: [{ n: 1 }] },
        { actorId: "actor", idempotencyKey: "sec-k1", payloadHash: "sec-h1" }
      );
      await store.appendTx(
        graphSpaceId,
        { txId: "tx-secret", metaEvents: [], graphEvents: [{ n: 2, _acl: { user: "deny" } }, { n: 3 }] },
        { actorId: "actor", idempotencyKey: "sec-k2", payloadHash: "sec-h2" }
      );
      await store.appendTx(
        graphSpaceId,
        { txId: "tx-public-2", metaEvents: [], graphEvents: [{ n: 4 }] },
        { actorId: "actor", idempotencyKey: "sec-k3", payloadHash: "sec-h3" }
      );

      const userRange = await store.readPrincipalTxRange(graphSpaceId, 0, 10, { principalId: "user" });
      expect(userRange.txs.map((tx) => tx.txId)).toEqual(["tx-public-1", "tx-public-2"]);
      expect(userRange.txs[0]?.txIndex).toBe(1);
      expect(userRange.txs[1]?.txIndex).toBe(2);
      expect(userRange.cursor).toBe(2);

      const page1 = await store.readPrincipalTxRange(graphSpaceId, 0, 1, { principalId: "user" });
      const page2 = await store.readPrincipalTxRange(graphSpaceId, page1.cursor, 1, { principalId: "user" });
      expect(page1.txs.map((tx) => tx.txId)).toEqual(["tx-public-1"]);
      expect(page2.txs.map((tx) => tx.txId)).toEqual(["tx-public-2"]);
      expect(page1.cursor).toBe(1);
      expect(page2.cursor).toBe(2);

      const engine = new PrincipalProjectionEngine(store, graphSpaceId);
      const adminView = await engine.rebuild({ principalId: "admin" });
      const userView = await engine.incremental({ principalId: "user" });

      expect(adminView.cursor).toBe(3);
      expect(userView.cursor).toBe(2);
      expect(userView.txIds).toEqual(["placeholder", "placeholder"]);
      expect(userView.txIds).not.toContain("tx-secret");
      expect(userView.txIds).not.toContain("tx-public-1");
      expect(userView.txIds).not.toContain("tx-public-2");
    });
  });
});

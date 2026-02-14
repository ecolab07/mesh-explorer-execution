import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { REASON_CODES } from "@mesh/shared";

// Invariant: absent and masked tx are indistinguishable (same category/code/shape and no metadata leaks); fail on any field divergence.
// Invariant: masking is transaction-wide (one masked event masks the whole tx); fail if any part of that tx is visible.
// Invariant: no observable side-channel via cursor/extra keys between absent and masked reads; fail if response shape differs.
describe.each(getConformanceBackends())("CT-S-* Security masking and indistinguishability (%s)", (backend: ConformanceBackend) => {
  let store: LocalEventStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const scope = await makeStore(backend);
    store = scope.store;
    cleanup = scope.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });
  it("[INV:CT-S-1][SURF:Security] CT-S-1: absent and masked tx are indistinguishable", async ({ task }) => {
    task.meta.invariantId = "CT-S-1";
    task.meta.surface = "Security";
    task.meta.oracle = "Masked and absent transaction reads must return identical normalized NOT_FOUND_OR_MASKED rejections.";
    task.meta.criticality = "Critical";
        const graphSpaceId = "space-s1";

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-masked",
        metaEvents: [{ kind: "meta" }],
        graphEvents: [{ kind: "node", _acl: { alice: "mask", "*": "deny" } }]
      },
      { actorId: "system", idempotencyKey: "s1-k1", payloadHash: "s1-h1" }
    );

    const missing = await store.readTxForPrincipal(graphSpaceId, "tx-absent", { principalId: "alice" });
    const masked = await store.readTxForPrincipal(graphSpaceId, "tx-masked", { principalId: "alice" });

    const expected = { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
    expect(missing).toEqual(expected);
    expect(masked).toEqual(expected);
    expect(Object.keys(masked).sort()).toEqual(Object.keys(missing).sort());
    expect(masked).not.toHaveProperty("baseRevision");
    expect(masked).not.toHaveProperty("cursor");
    expect(masked).not.toHaveProperty("metadata");
  });

  it("[INV:CT-S-2][SURF:Security] CT-S-2: masked event hides full transaction without observable holes", async ({ task }) => {
    task.meta.invariantId = "CT-S-2";
    task.meta.surface = "Security";
    task.meta.oracle = "Masked event visibility removes entire transaction from principal range without cursor holes.";
    task.meta.criticality = "Critical";
        const graphSpaceId = "space-s2";

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-visible-1",
        metaEvents: [{ op: "meta-1" }],
        graphEvents: [{ op: "graph-1" }]
      },
      { actorId: "system", idempotencyKey: "s2-k1", payloadHash: "s2-h1" }
    );

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-masked-transaction-wide",
        metaEvents: [{ op: "meta-2" }],
        graphEvents: [{ op: "graph-2a" }, { op: "graph-2b", _acl: { alice: "mask" } }]
      },
      { actorId: "system", idempotencyKey: "s2-k2", payloadHash: "s2-h2" }
    );

    await store.appendTx(
      graphSpaceId,
      {
        txId: "tx-visible-2",
        metaEvents: [{ op: "meta-3" }],
        graphEvents: [{ op: "graph-3" }]
      },
      { actorId: "system", idempotencyKey: "s2-k3", payloadHash: "s2-h3" }
    );

    const principalRead = await store.readPrincipalTxRange(graphSpaceId, 0, 10, { principalId: "alice" });
    expect(principalRead).toEqual({
      txs: [
        {
          txId: "tx-visible-1",
          txIndex: 1,
          meta: [expect.objectContaining({ txId: "tx-visible-1", stream: "meta", seq: 1 })],
          graph: [expect.objectContaining({ txId: "tx-visible-1", stream: "graph", seq: 1 })]
        },
        {
          txId: "tx-visible-2",
          txIndex: 3,
          meta: [expect.objectContaining({ txId: "tx-visible-2", stream: "meta", seq: 3 })],
          graph: [expect.objectContaining({ txId: "tx-visible-2", stream: "graph", seq: 4 })]
        }
      ],
      cursor: 2
    });
  });

  it("[INV:CT-S-3][SURF:Security] CT-S-3 contradiction: absent vs masked no side-channel shape", async ({ task }) => {
    task.meta.invariantId = "CT-S-3";
    task.meta.surface = "Security";
    task.meta.oracle = "Serialized response shape for masked and absent tx lookups must be indistinguishable.";
    task.meta.criticality = "Regression";
        const graphSpaceId = "space-s3";

    await store.appendTx(
      graphSpaceId,
      { txId: "tx-m", metaEvents: [], graphEvents: [{ kind: "hidden", _acl: { alice: "mask" } }] },
      { actorId: "system", idempotencyKey: "s3-k1", payloadHash: "s3-h1" }
    );

    const absent = await store.readTxForPrincipal(graphSpaceId, "tx-never-existed", { principalId: "alice" });
    const masked = await store.readTxForPrincipal(graphSpaceId, "tx-m", { principalId: "alice" });

    expect(JSON.stringify(masked)).toBe(JSON.stringify(absent));
  });
});

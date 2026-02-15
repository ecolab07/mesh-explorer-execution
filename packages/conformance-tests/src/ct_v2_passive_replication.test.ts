import { describe, expect, it } from "vitest";
import type { CommandOutcome, IdempotencyCtx, TxBundle } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import { type ConformanceBackend } from "./backends.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";
import { makePassiveReplicationHarness, type ReplicatedTxEnvelope } from "./v2/sim/passiveReplicator.js";

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const backends: ConformanceBackend[] = ["inmemory"];

describe.each(backends)("CT-PR-* V2 passive replication (%s)", (backend: ConformanceBackend) => {
  it("[INV:CT-PR-1][SURF:V2-PassiveReplication] CT-PR-1: exactly-once apply under duplicate delivery", async ({ task }) => {
    task.meta.invariantId = "CT-PR-1";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Across deterministic seeds [1..10], duplicate tx-envelope deliveries from writer-authority yield same final replica state and stable committed receipts.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const harness = await makePassiveReplicationHarness(backend, 1);
      const graphSpaceId = `space-v2-pr-1-${seed}`;
      try {
        const txBundle = makeTxBundle(`pr1-${seed}`, seed);
        await harness.appendOnPrimary(graphSpaceId, txBundle, makeIdem(`pr1-${seed}`));

        const shipped = await harness.shipFrom(harness.primary, graphSpaceId, 0);
        const envelope = shipped.txEnvelopes[0];
        expect(envelope, `seed=${seed}`).toBeDefined();

        const first = await harness.applyToReplica(harness.replicas[0], envelope);
        const second = await harness.applyToReplica(harness.replicas[0], envelope);

        expect(first, `seed=${seed}`).toEqual(second);
        expect(first.status, `seed=${seed}`).toBe("committed");

        const index = await harness.replicas[0].store.readTxIndex(graphSpaceId);
        expect(index, `seed=${seed}`).toHaveLength(1);
      } finally {
        await harness.cleanup();
      }
    }
  });

  it("[INV:CT-PR-2][SURF:V2-PassiveReplication] CT-PR-2: tx-order preservation across shipping", async ({ task }) => {
    task.meta.invariantId = "CT-PR-2";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Across deterministic seeds [1..10], replica applies txIndex-ordered stream safely under reorder: out-of-order deliveries are rejected until gaps are filled without state corruption.";
    task.meta.criticality = "Structural";

    for (const seed of seeds) {
      const harness = await makePassiveReplicationHarness(backend, 1);
      const graphSpaceId = `space-v2-pr-2-${seed}`;
      const network = makeSimNetwork<ReplicatedTxEnvelope>(seed + 200);

      try {
        await harness.appendOnPrimary(graphSpaceId, makeTxBundle(`pr2-a-${seed}`, seed), makeIdem(`pr2-a-${seed}`));
        await harness.appendOnPrimary(graphSpaceId, makeTxBundle(`pr2-b-${seed}`, seed + 1000), makeIdem(`pr2-b-${seed}`));

        const shipped = await harness.shipFrom(harness.primary, graphSpaceId, 0);
        for (const envelope of shipped.txEnvelopes) {
          network.send({ from: harness.primary.id, to: harness.replicas[0].id, payload: envelope });
        }
        network.reorder();

        const firstMessage = network.tick();
        const secondMessage = network.tick();
        expect(firstMessage && secondMessage, `seed=${seed}`).toBeTruthy();

        const firstOutcome = await harness.applyToReplica(harness.replicas[0], firstMessage!.payload);
        const secondOutcome = await harness.applyToReplica(harness.replicas[0], secondMessage!.payload);

        expect([firstOutcome.status, secondOutcome.status], `seed=${seed}`).toContain("rejected");

        const replay = await harness.shipFrom(harness.primary, graphSpaceId, 0);
        for (const envelope of replay.txEnvelopes) {
          await harness.applyToReplica(harness.replicas[0], envelope);
        }

        const txIds = (await harness.replicas[0].store.readTxIndex(graphSpaceId)).map((entry) => entry.txId);
        expect(txIds, `seed=${seed}`).toEqual([`pr2-a-${seed}`, `pr2-b-${seed}`]);
      } finally {
        await harness.cleanup();
      }
    }
  });

  it("[INV:CT-PR-3][SURF:V2-PassiveReplication] CT-PR-3: catch-up after downtime", async ({ task }) => {
    task.meta.invariantId = "CT-PR-3";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Across deterministic seeds [1..10], a replica offline for K tx catches up via poll-from-cursor and converges to primary txId set.";
    task.meta.criticality = "Structural";

    for (const seed of seeds) {
      const harness = await makePassiveReplicationHarness(backend, 1);
      const graphSpaceId = `space-v2-pr-3-${seed}`;
      try {
        for (let idx = 1; idx <= 5; idx += 1) {
          await harness.appendOnPrimary(graphSpaceId, makeTxBundle(`pr3-${seed}-${idx}`, seed + idx), makeIdem(`pr3-${seed}-${idx}`));
        }

        const firstPoll = await harness.shipFrom(harness.primary, graphSpaceId, 0);
        for (const envelope of firstPoll.txEnvelopes.slice(0, 2)) {
          await harness.applyToReplica(harness.replicas[0], envelope);
        }

        const offlineCursor = 2;
        const catchUp = await harness.shipFrom(harness.primary, graphSpaceId, offlineCursor);
        for (const envelope of catchUp.txEnvelopes) {
          const outcome = await harness.applyToReplica(harness.replicas[0], envelope);
          expect(outcome.status, `seed=${seed}`).toBe("committed");
        }

        const primaryTxIds = new Set((await harness.primary.store.readTxIndex(graphSpaceId)).map((entry) => entry.txId));
        const replicaTxIds = new Set((await harness.replicas[0].store.readTxIndex(graphSpaceId)).map((entry) => entry.txId));
        expect(replicaTxIds, `seed=${seed}`).toEqual(primaryTxIds);
      } finally {
        await harness.cleanup();
      }
    }
  });

  it("[INV:CT-PR-4][SURF:V2-PassiveReplication] CT-PR-4: divergence detection", async ({ task }) => {
    task.meta.invariantId = "CT-PR-4";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Across deterministic seeds [1..10], intentional envelope corruption is surfaced as normalized REPLICATION_DIVERGENCE_DETECTED error and replication does not proceed silently.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const harness = await makePassiveReplicationHarness(backend, 1);
      const graphSpaceId = `space-v2-pr-4-${seed}`;
      try {
        await harness.appendOnPrimary(graphSpaceId, makeTxBundle(`pr4-${seed}`, seed), makeIdem(`pr4-${seed}`));
        const shipped = await harness.shipFrom(harness.primary, graphSpaceId, 0);
        const base = shipped.txEnvelopes[0];

        const corrupted: ReplicatedTxEnvelope = {
          ...base,
          txBundle: {
            ...base.txBundle,
            graphEvents: [{ corrupted: true, seed }]
          }
        };

        const outcome = await harness.applyToReplica(harness.replicas[0], corrupted);
        assertNormalizedError(outcome);
        expect(outcome.reasonCode, `seed=${seed}`).toBe(REASON_CODES.REPLICATION_DIVERGENCE_DETECTED);

        const index = await harness.replicas[0].store.readTxIndex(graphSpaceId);
        expect(index, `seed=${seed}`).toHaveLength(0);
      } finally {
        await harness.cleanup();
      }
    }
  });

  it("Option A model: secondary is read-only in harness", async () => {
    const harness = await makePassiveReplicationHarness(backend, 1);
    const graphSpaceId = "space-v2-pr-write-guard";

    try {
      await expect(
        harness.appendOnNode(harness.replicas[0], graphSpaceId, makeTxBundle("guard", 1), makeIdem("guard"))
      ).rejects.toThrow(/direct write forbidden on replica/);
    } finally {
      await harness.cleanup();
    }
  });
});

function makeTxBundle(txId: string, value: number): TxBundle {
  return {
    txId,
    metaEvents: [],
    graphEvents: [{ op: "SET", value }]
  };
}

function makeIdem(key: string): IdempotencyCtx {
  return {
    actorId: "writer-authority",
    idempotencyKey: key,
    payloadHash: key
  };
}

function assertNormalizedError(outcome: CommandOutcome): asserts outcome is Exclude<CommandOutcome, { status: "committed" }> {
  expect(outcome.status).not.toBe("committed");
}

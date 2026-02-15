import { describe, expect, test } from "vitest";
import type { CommandOutcome, IdempotencyCtx, TxBundle } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import { getConformanceBackends, type ConformanceBackend } from "./backends.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";
import { makePassiveReplicationHarness, type PassiveNode, type ReplicatedTxEnvelope } from "./v2/sim/passiveReplicator.js";
import { createSeededRng } from "./v2/sim/seededRng.js";

const seeds = [1, 2, 3, 4, 5, 6] as const;
const backends: ConformanceBackend[] = getConformanceBackends();
const STEP_COUNT = 140;

describe.each(backends)("CT-PRC-* V2 passive replication chaos (%s)", (backend: ConformanceBackend) => {
  test(
    "[INV:CT-PRC-1][SURF:V2-PassiveReplication] CT-PRC-1 no divergence under chaos; replicas eventually converge when healed",
    async ({ task }) => {
      task.meta.invariantId = "CT-PRC-1";
      task.meta.surface = "V2-PassiveReplication";
      task.meta.oracle =
        "Under deterministic chaos (drop/dup/reorder/partition/restart), replicas can lag but always converge to the primary txId set after heal + flush.";
      task.meta.criticality = "Structural";

      for (const seed of seeds) {
        const result = await runChaosScenario({ backend, seed, steps: STEP_COUNT, maxQueueSize: 12 });
        expect(result.replicasConverged, `seed=${seed}`).toBe(true);
      }
    }
  );

  test("[INV:CT-PRC-2][SURF:V2-PassiveReplication] CT-PRC-2 restart safety under chaos", async ({ task }) => {
    task.meta.invariantId = "CT-PRC-2";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Deterministic primary/replica restarts under chaos never cause double-apply corruption and convergence remains reachable when healed.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const result = await runChaosScenario({ backend, seed: seed + 100, steps: STEP_COUNT, maxQueueSize: 12 });
      expect(result.restartAttempts, `seed=${seed}`).toBeGreaterThan(0);
      expect(result.duplicateApplyDetected, `seed=${seed}`).toBe(false);
      expect(result.replicasConverged, `seed=${seed}`).toBe(true);
    }
  });

  test("[INV:CT-PRC-3][SURF:V2-PassiveReplication] CT-PRC-3 bounded backlog behavior", async ({ task }) => {
    task.meta.invariantId = "CT-PRC-3";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "When maxQueueSize overflows during deterministic chaos, drops are surfaced via network stats and state integrity remains recoverable without silent corruption.";
    task.meta.criticality = "Regression";

    for (const seed of seeds) {
      const result = await runChaosScenario({ backend, seed: seed + 200, steps: STEP_COUNT, maxQueueSize: 6 });
      expect(result.networkStats.dropped, `seed=${seed}`).toBeGreaterThan(0);
      expect(result.corruptionDetected, `seed=${seed}`).toBe(false);
    }
  });
});



async function runChaosScenario({
  backend,
  seed,
  steps,
  maxQueueSize
}: {
  backend: ConformanceBackend;
  seed: number;
  steps: number;
  maxQueueSize: number;
}): Promise<{
  replicasConverged: boolean;
  restartAttempts: number;
  duplicateApplyDetected: boolean;
  corruptionDetected: boolean;
  networkStats: { delivered: number; dropped: number; duplicated: number; reordered: number };
}> {
  const rng = createSeededRng(seed);
  const harness = await makePassiveReplicationHarness(backend, 2);
  const graphSpaceId = `space-v2-pr-chaos-${backend}-${seed}`;
  const network = makeSimNetwork<ReplicatedTxEnvelope>(seed + 1000, { maxQueueSize });

  let txCounter = 0;
  let restartAttempts = 0;
  let duplicateApplyDetected = false;
  let corruptionDetected = false;

  try {
    for (let step = 0; step < steps; step += 1) {
      if (rng.chance(0.45)) {
        txCounter += 1;
        const txId = `prc-${seed}-${txCounter}`;
        const outcome = await harness.appendOnPrimary(graphSpaceId, makeTxBundle(txId, seed + step), makeIdem(txId));
        expect(outcome.status).toBe("committed");
      }

      for (const replica of harness.replicas) {
        if (!rng.chance(0.8)) continue;
        const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
        for (const envelope of shipped.txEnvelopes.slice(0, 1)) {
          network.send({ from: harness.primary.id, to: replica.id, payload: envelope });
        }
      }

      if (rng.chance(0.18)) {
        const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
        network.partition(harness.primary.id, replica.id);
      }
      if (rng.chance(0.12)) {
        network.heal();
      }

      network.drop(0.08);
      network.duplicate(0.06);
      if (rng.chance(0.2)) {
        network.reorder();
      }

      if (step > 0 && step % 50 === 0) {
        restartAttempts += 1;
        await harness.restartPrimary();
        restartAttempts += 1;
        await harness.restartReplica(harness.replicas[step % harness.replicas.length]);
      }

      if (rng.chance(0.08)) {
        restartAttempts += 1;
        await harness.restartPrimary();
      }
      if (rng.chance(0.12)) {
        restartAttempts += 1;
        const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
        await harness.restartReplica(replica);
      }

      const deliveries = 1 + rng.nextInt(3);
      for (let idx = 0; idx < deliveries; idx += 1) {
        const message = network.tick();
        if (!message) break;
        const outcome = await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
        assertExpectedReplicationOutcome(outcome);
      }

      if ((step + 1) % 10 === 0) {
        const snapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
        for (const replicaSet of snapshot.replicas) {
          for (const txId of replicaSet) {
            if (!snapshot.primary.has(txId)) {
              corruptionDetected = true;
            }
          }
        }
        duplicateApplyDetected ||= snapshot.hasDuplicateEntries;
      }
    }

    await flushUntilConverged(harness, network, graphSpaceId);
    const finalSnapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
    duplicateApplyDetected ||= finalSnapshot.hasDuplicateEntries;

    return {
      replicasConverged: finalSnapshot.replicas.every((replicaSet) => sameSet(replicaSet, finalSnapshot.primary)),
      restartAttempts,
      duplicateApplyDetected,
      corruptionDetected,
      networkStats: network.stats()
    };
  } finally {
    await harness.cleanup();
  }
}

async function flushUntilConverged(
  harness: Awaited<ReturnType<typeof makePassiveReplicationHarness>>,
  network: ReturnType<typeof makeSimNetwork<ReplicatedTxEnvelope>>,
  graphSpaceId: string
): Promise<void> {
  network.heal();
  for (let round = 0; round < 400; round += 1) {
    for (const replica of harness.replicas) {
      const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
      for (const envelope of shipped.txEnvelopes.slice(0, 1)) {
        network.send({ from: harness.primary.id, to: replica.id, payload: envelope });
      }
    }

    let delivered = 0;
    while (network.pending() > 0 && delivered < 200) {
      const message = network.tick();
      if (!message) break;
      const outcome = await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
      assertExpectedReplicationOutcome(outcome);
      delivered += 1;
    }

    const snapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
    if (snapshot.replicas.every((replicaSet) => sameSet(replicaSet, snapshot.primary))) {
      return;
    }
  }
}

async function readTxSets(primary: PassiveNode, replicas: PassiveNode[], graphSpaceId: string): Promise<{
  primary: Set<string>;
  replicas: Set<string>[];
  hasDuplicateEntries: boolean;
}> {
  const primaryIndex = await primary.store.readTxIndex(graphSpaceId);
  const replicaIndexes = await Promise.all(replicas.map((replica) => replica.store.readTxIndex(graphSpaceId)));

  const hasDuplicateEntries = [primaryIndex, ...replicaIndexes].some((index) => new Set(index.map((entry) => entry.txId)).size !== index.length);

  return {
    primary: new Set(primaryIndex.map((entry) => entry.txId)),
    replicas: replicaIndexes.map((index) => new Set(index.map((entry) => entry.txId))),
    hasDuplicateEntries
  };
}

async function lastAppliedTxIndex(replica: PassiveNode, graphSpaceId: string): Promise<number> {
  const index = await replica.store.readTxIndex(graphSpaceId);
  return index.at(-1)?.txIndex ?? 0;
}

function resolveReplica(replicas: PassiveNode[], id: string): PassiveNode {
  const replica = replicas.find((node) => node.id === id);
  if (!replica) {
    throw new Error(`unknown replica id: ${id}`);
  }
  return replica;
}

function assertExpectedReplicationOutcome(outcome: CommandOutcome): void {
  if (outcome.status === "committed") return;
  if (outcome.reasonCode === REASON_CODES.REPLICATION_ORDER_GAP) return;
  if (outcome.reasonCode === REASON_CODES.REPLICATION_DIVERGENCE_DETECTED) return;
  throw new Error(`unexpected replication outcome: ${outcome.status}/${outcome.reasonCode}`);
}

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

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

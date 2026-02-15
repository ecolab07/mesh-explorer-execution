import { describe, expect, test } from "vitest";
import type { CommandOutcome, IdempotencyCtx, TxBundle } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import type { ConformanceBackend } from "./backends.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";
import { makePassiveReplicationHarness, type PassiveNode, type ReplicatedTxEnvelope } from "./v2/sim/passiveReplicator.js";
import { createSeededRng } from "./v2/sim/seededRng.js";
import { getChaosBackends, getChaosMode, getChaosSeeds, getChaosStepCount } from "./v2/sim/chaosConfig.js";
import { recordChaosStats, type ChaosStatsRecord } from "./v2/sim/chaosStats.js";

const CHAOS_MODE = getChaosMode();
const seeds = getChaosSeeds();
const backends: ConformanceBackend[] = getChaosBackends();
const STEP_COUNT = getChaosStepCount();
const TEST_TIMEOUT_MS = CHAOS_MODE === "soak" ? 120_000 : 10_000;
const PRC1_SEEDS = selectSeedSlice(seeds, 0, 3);
const PRC2_SEEDS = selectSeedSlice(seeds, 1, 3);
const PRC3_SEEDS = selectSeedSlice(seeds, 2, 3);

describe.each(backends)("CT-PRC-* V2 passive replication chaos (%s)", (backend: ConformanceBackend) => {
  test(
    "[INV:CT-PRC-1][SURF:V2-PassiveReplication] CT-PRC-1 no divergence under chaos; replicas eventually converge when healed",
    async ({ task }) => {
      task.meta.invariantId = "CT-PRC-1";
      task.meta.surface = "V2-PassiveReplication";
      task.meta.oracle =
        "Under deterministic chaos (drop/dup/reorder/partition/restart), replicas can lag but always converge to the primary txId set after heal + flush.";
      task.meta.criticality = "Structural";

      for (const seed of PRC1_SEEDS) {
        const result = await runChaosScenario({ testId: "CT-PRC-1", backend, seed, steps: STEP_COUNT, maxQueueSize: 12 });
        const repro = reproLine({ backend, seed, steps: STEP_COUNT, testId: "CT-PRC-1" });
        expect(result.replicasConverged, repro).toBe(true);
      }
    },
    TEST_TIMEOUT_MS
  );

  test("[INV:CT-PRC-2][SURF:V2-PassiveReplication] CT-PRC-2 restart safety under chaos", async ({ task }) => {
    task.meta.invariantId = "CT-PRC-2";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "Deterministic primary/replica restarts under chaos never cause double-apply corruption and convergence remains reachable when healed.";
    task.meta.criticality = "Critical";

    for (const seed of PRC2_SEEDS) {
      const result = await runChaosScenario({
        testId: "CT-PRC-2",
        backend,
        seed,
        steps: STEP_COUNT,
        maxQueueSize: 12
      });
      const repro = reproLine({ backend, seed, steps: STEP_COUNT, testId: "CT-PRC-2" });
      expect(result.restartAttempts, repro).toBeGreaterThan(0);
      expect(result.duplicateApplyDetected, repro).toBe(false);
      expect(result.replicasConverged, repro).toBe(true);
    }
  }, TEST_TIMEOUT_MS);

  test("[INV:CT-PRC-3][SURF:V2-PassiveReplication] CT-PRC-3 bounded backlog behavior", async ({ task }) => {
    task.meta.invariantId = "CT-PRC-3";
    task.meta.surface = "V2-PassiveReplication";
    task.meta.oracle =
      "When maxQueueSize overflows during deterministic chaos, drops are surfaced via network stats and state integrity remains recoverable without silent corruption.";
    task.meta.criticality = "Regression";

    for (const seed of PRC3_SEEDS) {
      const result = await runChaosScenario({
        testId: "CT-PRC-3",
        backend,
        seed,
        steps: STEP_COUNT,
        maxQueueSize: 6
      });
      const repro = reproLine({ backend, seed, steps: STEP_COUNT, testId: "CT-PRC-3" });
      expect(result.networkStats.dropped, repro).toBeGreaterThan(0);
      expect(result.corruptionDetected, repro).toBe(false);
    }
  }, TEST_TIMEOUT_MS);
});


function selectSeedSlice(source: number[], offset: number, totalSlices: number): number[] {
  return source.filter((_, index) => index % totalSlices === offset);
}

type ChaosScenarioResult = {
  replicasConverged: boolean;
  restartAttempts: number;
  duplicateApplyDetected: boolean;
  corruptionDetected: boolean;
  networkStats: { delivered: number; dropped: number; duplicated: number; reordered: number; partitions: number; heals: number };
};

async function runChaosScenario({
  testId,
  backend,
  seed,
  steps,
  maxQueueSize
}: {
  testId: string;
  backend: ConformanceBackend;
  seed: number;
  steps: number;
  maxQueueSize: number;
}): Promise<ChaosScenarioResult> {
  const rng = createSeededRng(seed);
  const harness = await makePassiveReplicationHarness(backend, 2);
  const graphSpaceId = `space-v2-pr-chaos-${backend}-${seed}`;
  const network = makeSimNetwork<ReplicatedTxEnvelope>(seed + 1000, { maxQueueSize });

  let txCounter = 0;
  let restartAttempts = 0;
  let duplicateApplyDetected = false;
  let corruptionDetected = false;
  let convergenceStep: number | null = null;
  let lastAction = "init";
  let failureStep: number | null = null;

  try {
    for (let step = 0; step < steps; step += 1) {
      if (rng.chance(0.45)) {
        txCounter += 1;
        const txId = `prc-${seed}-${txCounter}`;
        const action = `append:${txId}`;
        const outcome = await harness.appendOnPrimary(graphSpaceId, makeTxBundle(txId, seed + step), makeIdem(txId));
        expect(outcome.status, reproLine({ backend, seed, steps, testId, step, lastAction: action })).toBe("committed");
        lastAction = action;
      }

      for (const replica of harness.replicas) {
        if (!rng.chance(0.8)) continue;
        const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
        for (const envelope of shipped.txEnvelopes.slice(0, 1)) {
          network.send({ from: harness.primary.id, to: replica.id, payload: envelope });
          lastAction = `ship:${harness.primary.id}->${replica.id}`;
        }
      }

      if (rng.chance(0.18)) {
        const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
        network.partition(harness.primary.id, replica.id);
        lastAction = `partition:${replica.id}`;
      }
      if (rng.chance(0.12)) {
        network.heal();
        lastAction = "heal";
      }

      network.drop(0.08);
      network.duplicate(0.06);
      if (rng.chance(0.2)) {
        network.reorder();
        lastAction = "reorder";
      }

      if (step > 0 && step % 50 === 0) {
        restartAttempts += 1;
        await harness.restartPrimary();
        restartAttempts += 1;
        await harness.restartReplica(harness.replicas[step % harness.replicas.length]);
        lastAction = "scheduled-restart";
      }

      if (rng.chance(0.08)) {
        restartAttempts += 1;
        await harness.restartPrimary();
        lastAction = "restart-primary";
      }
      if (rng.chance(0.12)) {
        restartAttempts += 1;
        const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
        await harness.restartReplica(replica);
        lastAction = `restart-${replica.id}`;
      }

      const deliveries = 1 + rng.nextInt(3);
      for (let idx = 0; idx < deliveries; idx += 1) {
        const message = network.tick();
        if (!message) break;
        const outcome = await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
        assertExpectedReplicationOutcome(outcome);
        lastAction = `deliver:${message.to}`;
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

        if (snapshot.replicas.every((replicaSet) => sameSet(replicaSet, snapshot.primary)) && convergenceStep === null) {
          convergenceStep = step + 1;
        }
      }
    }

    await flushUntilConverged(harness, network, graphSpaceId);
    const finalSnapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
    duplicateApplyDetected ||= finalSnapshot.hasDuplicateEntries;

    const result: ChaosScenarioResult = {
      replicasConverged: finalSnapshot.replicas.every((replicaSet) => sameSet(replicaSet, finalSnapshot.primary)),
      restartAttempts,
      duplicateApplyDetected,
      corruptionDetected,
      networkStats: network.stats()
    };

    await recordChaosStats(
      toChaosStats({
        testId,
        backend,
        seed,
        steps,
        result,
        convergenceStep,
        failureStep,
        lastAction,
        finalSnapshot
      })
    );

    return result;
  } catch (error) {
    failureStep = inferFailureStep(error) ?? failureStep;
    const finalSnapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
    await recordChaosStats(
      toChaosStats({
        testId,
        backend,
        seed,
        steps,
        result: {
          replicasConverged: false,
          restartAttempts,
          duplicateApplyDetected,
          corruptionDetected,
          networkStats: network.stats()
        },
        convergenceStep,
        failureStep,
        lastAction,
        finalSnapshot,
        failedInvariantId: testId
      })
    );
    throw error;
  } finally {
    await harness.cleanup();
  }
}

function toChaosStats({
  testId,
  backend,
  seed,
  steps,
  result,
  convergenceStep,
  failureStep,
  lastAction,
  finalSnapshot,
  failedInvariantId
}: {
  testId: string;
  backend: ConformanceBackend;
  seed: number;
  steps: number;
  result: ChaosScenarioResult;
  convergenceStep: number | null;
  failureStep: number | null;
  lastAction: string;
  finalSnapshot: Awaited<ReturnType<typeof readTxSets>>;
  failedInvariantId?: string;
}): ChaosStatsRecord {
  return {
    testId,
    mode: CHAOS_MODE,
    seed,
    steps,
    backend,
    delivered: result.networkStats.delivered,
    dropped: result.networkStats.dropped,
    duplicated: result.networkStats.duplicated,
    reordered: result.networkStats.reordered,
    partitions: result.networkStats.partitions,
    heals: result.networkStats.heals,
    nbTxPrimary: finalSnapshot.primary.size,
    nbTxReplicaA: finalSnapshot.replicas[0]?.size ?? 0,
    nbTxReplicaB: finalSnapshot.replicas[1]?.size ?? 0,
    convergenceReached: result.replicasConverged,
    convergenceStep,
    failedInvariantId: failedInvariantId ?? null,
    failureStep,
    lastAction
  };
}

function inferFailureStep(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const matched = error.message.match(/step=(\d+)/);
  if (!matched) return null;
  return Number.parseInt(matched[1], 10);
}

function reproLine({
  backend,
  seed,
  steps,
  testId,
  step,
  lastAction
}: {
  backend: ConformanceBackend;
  seed: number;
  steps: number;
  testId: string;
  step?: number;
  lastAction?: string;
}): string {
  const suffix = [testId ? `test=${testId}` : null, step !== undefined ? `step=${step}` : null, lastAction ? `lastAction=${lastAction}` : null]
    .filter(Boolean)
    .join(" ");
  return `REPRO: MESH_CHAOS_SEEDS=${seed} MESH_CHAOS_STEPS=${steps} MESH_CHAOS_BACKEND=${backend}${suffix ? ` ${suffix}` : ""}`;
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

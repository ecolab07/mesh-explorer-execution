import { describe, expect, test } from "vitest";
import type { IdempotencyCtx, TxBundle } from "@mesh/shared";
import { makePassiveReplicationHarness, type PassiveNode, type ReplicatedTxEnvelope } from "./v2/sim/passiveReplicator.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";
import { runSeededSteps } from "./v2/sim/stepRunner.js";
import { getChaosBackends, getChaosMode, getChaosSeeds, getChaosStepCount } from "./v2/sim/chaosConfig.js";
import type { ConformanceBackend } from "./backends.js";
import { recordChaosStats } from "./v2/sim/chaosStats.js";

const mode = getChaosMode();
const seeds = getChaosSeeds();
const steps = getChaosStepCount();
const backends = getChaosBackends();

describe.each(backends)("CT-PR-FUZZ V2 passive replication fuzz (%s)", (backend: ConformanceBackend) => {
  test.each(seeds)("deterministic fuzz seed=%i", async (seed) => {
    const harness = await makePassiveReplicationHarness(backend, 2);
    const graphSpaceId = `space-v2-pr-fuzz-${backend}-${seed}`;
    const network = makeSimNetwork<ReplicatedTxEnvelope>(seed + 9000, { maxQueueSize: 24 });

    let txCounter = 0;
    let partitioned = false;
    let convergenceStep: number | null = null;
    let lastAction = "init";

    try {
      const actions = Array.from({ length: steps }, (_, stepIndex) => async ({ rng }: { rng: { chance: (p: number) => boolean; nextInt: (n: number) => number } }) => {
        const roll = rng.nextInt(9);

        switch (roll) {
          case 0: {
            txCounter += 1;
            const txId = `fuzz-${seed}-${txCounter}`;
            const action = `submit:${txId}`;
            const outcome = await harness.appendOnPrimary(graphSpaceId, makeTxBundle(txId, seed + stepIndex), makeIdem(txId));
            expect(outcome.status, repro(seed, backend, stepIndex, action)).toBe("committed");
            lastAction = action;
            break;
          }
          case 1:
          case 2: {
            const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
            const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
            const first = shipped.txEnvelopes[0];
            if (first) {
              network.send({ from: harness.primary.id, to: replica.id, payload: first });
              lastAction = `ship:${replica.id}`;
            }
            break;
          }
          case 3:
            network.drop(0.25);
            lastAction = "drop";
            break;
          case 4:
            network.duplicate(0.3);
            lastAction = "duplicate";
            break;
          case 5:
            network.reorder();
            lastAction = "reorder";
            break;
          case 6: {
            const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
            network.partition(harness.primary.id, replica.id);
            partitioned = true;
            lastAction = `partition:${replica.id}`;
            break;
          }
          case 7:
            network.heal();
            partitioned = false;
            lastAction = "heal";
            break;
          case 8: {
            if (rng.chance(0.4)) {
              await harness.restartPrimary();
              lastAction = "restart-primary";
            } else {
              const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
              await harness.restartReplica(replica);
              lastAction = `restart-${replica.id}`;
            }
            break;
          }
        }

        if (rng.chance(0.75)) {
          const message = network.tick();
          if (message) {
            await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
            lastAction = `deliver:${message.to}`;
          }
        }

        if ((stepIndex + 1) % 20 === 0) {
          const snapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
          for (const replicaSet of snapshot.replicas) {
            for (const txId of replicaSet) {
              expect(snapshot.primary.has(txId), repro(seed, backend, stepIndex, "no-silent-divergence")).toBe(true);
            }
          }
          expect(snapshot.hasDuplicateEntries, repro(seed, backend, stepIndex, "no-double-apply")).toBe(false);

          if (!partitioned) {
            expect(snapshot.replicas[0].size, repro(seed, backend, stepIndex, "idempotence/dup-harmless")).toBeLessThanOrEqual(snapshot.primary.size);
            expect(snapshot.replicas[1].size, repro(seed, backend, stepIndex, "idempotence/dup-harmless")).toBeLessThanOrEqual(snapshot.primary.size);
          }

          if (snapshot.replicas.every((replicaSet) => sameSet(replicaSet, snapshot.primary)) && convergenceStep === null) {
            convergenceStep = stepIndex + 1;
          }
        }
      });

      await runSeededSteps(seed, actions);

      network.heal();
      await flush(harness, network, graphSpaceId, 500);
      const finalSnapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
      expect(finalSnapshot.hasDuplicateEntries, repro(seed, backend, steps, "no-double-apply-final")).toBe(false);
      expect(sameSet(finalSnapshot.replicas[0], finalSnapshot.primary), repro(seed, backend, steps, "convergence-after-heal+flush")).toBe(true);
      expect(sameSet(finalSnapshot.replicas[1], finalSnapshot.primary), repro(seed, backend, steps, "convergence-after-heal+flush")).toBe(true);

      await recordChaosStats({
        testId: "CT-PR-FUZZ",
        mode,
        seed,
        steps,
        backend,
        delivered: network.stats().delivered,
        dropped: network.stats().dropped,
        duplicated: network.stats().duplicated,
        reordered: network.stats().reordered,
        partitions: network.stats().partitions,
        heals: network.stats().heals,
        nbTxPrimary: finalSnapshot.primary.size,
        nbTxReplicaA: finalSnapshot.replicas[0]?.size ?? 0,
        nbTxReplicaB: finalSnapshot.replicas[1]?.size ?? 0,
        convergenceReached: true,
        convergenceStep,
        failedInvariantId: null,
        failureStep: null,
        lastAction
      });
    } catch (error) {
      const failedStep = inferFailureStep(error);
      await recordChaosStats({
        testId: "CT-PR-FUZZ",
        mode,
        seed,
        steps,
        backend,
        delivered: network.stats().delivered,
        dropped: network.stats().dropped,
        duplicated: network.stats().duplicated,
        reordered: network.stats().reordered,
        partitions: network.stats().partitions,
        heals: network.stats().heals,
        nbTxPrimary: 0,
        nbTxReplicaA: 0,
        nbTxReplicaB: 0,
        convergenceReached: false,
        convergenceStep,
        failedInvariantId: "CT-PR-FUZZ",
        failureStep: failedStep,
        lastAction
      });
      throw error;
    } finally {
      await harness.cleanup();
    }
  });
});

function repro(seed: number, backend: ConformanceBackend, step: number, action: string): string {
  return `REPRO: MESH_CHAOS_SEEDS=${seed} MESH_CHAOS_STEPS=${steps} MESH_CHAOS_BACKEND=${backend} step=${step} lastAction=${action}`;
}

function inferFailureStep(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const matched = error.message.match(/step=(\d+)/);
  if (!matched) return null;
  return Number.parseInt(matched[1], 10);
}

async function flush(
  harness: Awaited<ReturnType<typeof makePassiveReplicationHarness>>,
  network: ReturnType<typeof makeSimNetwork<ReplicatedTxEnvelope>>,
  graphSpaceId: string,
  maxRounds: number
): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    for (const replica of harness.replicas) {
      const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
      for (const envelope of shipped.txEnvelopes.slice(0, 2)) {
        network.send({ from: harness.primary.id, to: replica.id, payload: envelope });
      }
    }

    while (network.pending() > 0) {
      const message = network.tick();
      if (!message) break;
      await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
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

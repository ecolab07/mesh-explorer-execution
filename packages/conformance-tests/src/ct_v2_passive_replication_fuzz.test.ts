import { describe, expect, test } from "vitest";
import type { IdempotencyCtx, TxBundle } from "@mesh/shared";
import { makePassiveReplicationHarness, type PassiveNode, type ReplicatedTxEnvelope } from "./v2/sim/passiveReplicator.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";
import { runSeededSteps } from "./v2/sim/stepRunner.js";
import { getChaosBackends, getChaosSeeds, getChaosStepCount } from "./v2/sim/chaosConfig.js";
import type { ConformanceBackend } from "./backends.js";

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

    try {
      const actions = Array.from({ length: steps }, (_, stepIndex) => async ({ rng }: { rng: { chance: (p: number) => boolean; nextInt: (n: number) => number } }) => {
        const roll = rng.nextInt(9);

        switch (roll) {
          case 0: {
            txCounter += 1;
            const txId = `fuzz-${seed}-${txCounter}`;
            const outcome = await harness.appendOnPrimary(graphSpaceId, makeTxBundle(txId, seed + stepIndex), makeIdem(txId));
            expect(outcome.status, repro(seed, backend, stepIndex, `submit:${txId}`)).toBe("committed");
            break;
          }
          case 1:
          case 2: {
            const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
            const shipped = await harness.shipFrom(harness.primary, graphSpaceId, await lastAppliedTxIndex(replica, graphSpaceId));
            const first = shipped.txEnvelopes[0];
            if (first) {
              network.send({ from: harness.primary.id, to: replica.id, payload: first });
            }
            break;
          }
          case 3:
            network.drop(0.25);
            break;
          case 4:
            network.duplicate(0.3);
            break;
          case 5:
            network.reorder();
            break;
          case 6: {
            const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
            network.partition(harness.primary.id, replica.id);
            partitioned = true;
            break;
          }
          case 7:
            network.heal();
            partitioned = false;
            break;
          case 8: {
            if (rng.chance(0.4)) {
              await harness.restartPrimary();
            } else {
              const replica = harness.replicas[rng.nextInt(harness.replicas.length)];
              await harness.restartReplica(replica);
            }
            break;
          }
        }

        if (rng.chance(0.75)) {
          const message = network.tick();
          if (message) {
            await harness.applyToReplica(resolveReplica(harness.replicas, message.to), message.payload);
          }
        }

        if ((stepIndex + 1) % 20 === 0) {
          const snapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
          for (const replicaSet of snapshot.replicas) {
            for (const txId of replicaSet) {
              expect(snapshot.primary.has(txId), repro(seed, backend, stepIndex, "no-silent-divergence")).toBe(true);
            }
          }

          if (!partitioned) {
            expect(snapshot.replicas[0].size, repro(seed, backend, stepIndex, "idempotence/dup-harmless"))
              .toBeLessThanOrEqual(snapshot.primary.size);
            expect(snapshot.replicas[1].size, repro(seed, backend, stepIndex, "idempotence/dup-harmless"))
              .toBeLessThanOrEqual(snapshot.primary.size);
          }
        }
      });

      await runSeededSteps(seed, actions);

      network.heal();
      await flush(harness, network, graphSpaceId, 500);
      const finalSnapshot = await readTxSets(harness.primary, harness.replicas, graphSpaceId);
      expect(sameSet(finalSnapshot.replicas[0], finalSnapshot.primary), repro(seed, backend, steps, "convergence-after-heal+flush")).toBe(true);
      expect(sameSet(finalSnapshot.replicas[1], finalSnapshot.primary), repro(seed, backend, steps, "convergence-after-heal+flush")).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});

function repro(seed: number, backend: ConformanceBackend, step: number, action: string): string {
  return `REPRO: seed=${seed} steps=${steps} backend=${backend} step=${step} lastAction=${action}`;
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
}> {
  const primaryIndex = await primary.store.readTxIndex(graphSpaceId);
  const replicaIndexes = await Promise.all(replicas.map((replica) => replica.store.readTxIndex(graphSpaceId)));
  return {
    primary: new Set(primaryIndex.map((entry) => entry.txId)),
    replicas: replicaIndexes.map((index) => new Set(index.map((entry) => entry.txId)))
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

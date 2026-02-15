import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import type { CommandOutcome } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import { makeStore, type ConformanceBackend } from "./backends.js";
import { runSeededSteps } from "./v2/sim/stepRunner.js";
import { SimWriters } from "./v2/sim/simWriters.js";

const seeds = [1, 2, 3, 4, 5] as const;
const backends: ConformanceBackend[] = ["inmemory"];

describe.each(backends)("CT-MW-* V2-lite multi-writer (%s)", (backend: ConformanceBackend) => {
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

  it("[INV:CT-MW-1][SURF:V2-MultiWriter] CT-MW-1: conflicting baseRevision at most one commit succeeds", async ({ task }) => {
    task.meta.invariantId = "CT-MW-1";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Across deterministic seeds [1..5], two conflicting writers yield exactly one committed receipt and one normalized precondition/validation rejection.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const kernel = new KernelMinimalImpl(store);
      const writers = new SimWriters(kernel, 2);
      const outcomes: CommandOutcome[] = [];

      await runSeededSteps(seed, [
        async () => {
          outcomes.push(await writers.submitCommand(0, {
            graphSpaceId: `space-v2-mw-1-${seed}`,
            commandId: `mw1-commit-${seed}`,
            idempotencyKey: `idem-commit-${seed}`,
            payload: { op: "SET", seed }
          }));
        },
        async () => {
          outcomes.push(
            await writers.submitWithStaleBaseRevision(
              1,
              {
                graphSpaceId: `space-v2-mw-1-${seed}`,
                commandId: `mw1-stale-${seed}`,
                idempotencyKey: `idem-stale-${seed}`,
                payload: { op: "SET", seed, writer: 1 }
              },
              "rev/stale"
            )
          );
        }
      ]);

      const committed = outcomes.filter((outcome) => outcome.status === "committed");
      const rejected = outcomes.filter((outcome) => outcome.status !== "committed");
      expect(committed, `seed=${seed}`).toHaveLength(1);
      expect(rejected, `seed=${seed}`).toHaveLength(1);
      expect([REASON_CODES.REVISION_MISMATCH, REASON_CODES.INVALID_BASE_REVISION], `seed=${seed}`).toContain(
        rejected[0]?.reasonCode
      );
    }
  });

  it("[INV:CT-MW-2][SURF:V2-MultiWriter] CT-MW-2: same idempotencyKey concurrently does not double-commit", async ({ task }) => {
    task.meta.invariantId = "CT-MW-2";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Across deterministic seeds [1..5], concurrent same actorId+idempotencyKey produces one visible transaction and equivalent receipts.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const kernel = new KernelMinimalImpl(store);
      const writers = new SimWriters(kernel, 2);
      const outcomes: CommandOutcome[] = [];
      const graphSpaceId = `space-v2-mw-2-${seed}`;

      await runSeededSteps(seed, [
        async () => {
          outcomes.push(
            await writers.submitCommand(0, {
              graphSpaceId,
              commandId: `mw2-primary-${seed}`,
              actorId: "same-actor",
              idempotencyKey: `shared-idem-${seed}`,
              payload: { op: "UPSERT", value: seed }
            })
          );
        },
        async () => {
          outcomes.push(
            await writers.retrySameIdempotency(1, {
              graphSpaceId,
              commandId: `mw2-retry-${seed}`,
              actorId: "same-actor",
              idempotencyKey: `shared-idem-${seed}`,
              payload: { op: "UPSERT", value: seed }
            })
          );
        }
      ]);

      expect(outcomes[0], `seed=${seed}`).toEqual(outcomes[1]);

      const txIndex = await store.readTxIndex(graphSpaceId);
      expect(txIndex, `seed=${seed}`).toHaveLength(1);
      expect(new Set(txIndex.map((entry) => entry.txId)), `seed=${seed}`).toEqual(new Set([`mw2-primary-${seed}`]));
    }
  });

  it("[INV:CT-MW-3][SURF:V2-MultiWriter] CT-MW-3: tx-closed visibility survives deterministic interleavings", async ({ task }) => {
    task.meta.invariantId = "CT-MW-3";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Across deterministic seeds [1..5], interleaved reads over graph stream only observe tx-closed slices (no partial tx visible).";
    task.meta.criticality = "Structural";

    for (const seed of seeds) {
      const kernel = new KernelMinimalImpl(store);
      const writers = new SimWriters(kernel, 2);
      const seenTxIds: string[] = [];
      const graphSpaceId = `space-v2-mw-3-${seed}`;

      await runSeededSteps(seed, [
        async () => {
          await writers.submitCommand(0, {
            graphSpaceId,
            commandId: `mw3-a-${seed}`,
            payload: { op: "SET", writer: 0, seed }
          });
        },
        async ({ rng }) => {
          const from = rng.nextInt(2);
          const rows = await store.readRange(graphSpaceId, "graph", from, 1, "TX_CLOSED");
          seenTxIds.push(...rows.map((row) => row.txId));
        },
        async () => {
          await writers.submitCommand(1, {
            graphSpaceId,
            commandId: `mw3-b-${seed}`,
            payload: { op: "SET", writer: 1, seed }
          });
        },
        async () => {
          const rows = await store.readRange(graphSpaceId, "graph", 0, 1, "TX_CLOSED");
          seenTxIds.push(...rows.map((row) => row.txId));
        }
      ]);

      expect(seenTxIds.every((txId) => txId === `mw3-a-${seed}` || txId === `mw3-b-${seed}`), `seed=${seed}`).toBe(true);
      const txIndex = await store.readTxIndex(graphSpaceId);
      expect(txIndex, `seed=${seed}`).toHaveLength(2);
      expect(txIndex.map((entry) => entry.txId), `seed=${seed}`).toEqual([`mw3-a-${seed}`, `mw3-b-${seed}`]);
    }
  });
});

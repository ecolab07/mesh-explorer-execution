import { describe, expect, it } from "vitest";
import { LocalSyncHarness } from "@mesh/sync-local";
import type { IdempotencyCtx, TxBundle } from "@mesh/shared";
import { type ConformanceBackend } from "./backends.js";
import { applyReplicatedTx, makeSimPeers, type TxEnvelope } from "./v2/sim/simPeers.js";
import { runSeededSteps } from "./v2/sim/stepRunner.js";
import { makeSimNetwork } from "./v2/sim/simNetwork.js";

const seeds = [1, 2, 3, 4, 5] as const;
const backends: ConformanceBackend[] = ["inmemory"];

describe.each(backends)("CT-RS-* V2-lite remote sync (%s)", (backend: ConformanceBackend) => {
  it("[INV:CT-RS-1][SURF:V2-RemoteSync] CT-RS-1: eventual delivery converges under dup+reorder", async ({ task }) => {
    task.meta.invariantId = "CT-RS-1";
    task.meta.surface = "V2-RemoteSync";
    task.meta.oracle =
      "Across deterministic seeds [1..5], sufficient ticks without drops make both peers converge on identical txId sets despite duplicates/reorder.";
    task.meta.criticality = "Structural";

    for (const seed of seeds) {
      const peers = await makeSimPeers(backend);
      const graphSpaceId = `space-v2-rs-1-${seed}`;
      const network = makeSimNetwork<TxEnvelope>(seed);

      try {
        await runSeededSteps(seed, [
          async () => {
            await peers.A.store.appendTx(
              graphSpaceId,
              { txId: `rs1-a-${seed}`, metaEvents: [], graphEvents: [{ n: 1, seed }] },
              { actorId: "peer-a", idempotencyKey: `rs1-idem-a-${seed}`, payloadHash: `h-a-${seed}` }
            );
            network.send({ from: "A", to: "B", payload: makeEnvelope(graphSpaceId, `rs1-a-${seed}`, `rs1-idem-a-${seed}`, { n: 1, seed }) });
          },
          async () => {
            await peers.B.store.appendTx(
              graphSpaceId,
              { txId: `rs1-b-${seed}`, metaEvents: [], graphEvents: [{ n: 2, seed }] },
              { actorId: "peer-b", idempotencyKey: `rs1-idem-b-${seed}`, payloadHash: `h-b-${seed}` }
            );
            network.send({ from: "B", to: "A", payload: makeEnvelope(graphSpaceId, `rs1-b-${seed}`, `rs1-idem-b-${seed}`, { n: 2, seed }) });
          },
          async () => {
            network.duplicate(0.6);
            network.reorder();
          }
        ]);

        for (let tick = 0; tick < 20 && network.pending() > 0; tick += 1) {
          const message = network.tick();
          if (!message) continue;
          const target = message.to === "A" ? peers.A : peers.B;
          await applyReplicatedTx(target, message.payload);
        }

        const txA = new Set((await peers.A.store.readTxIndex(graphSpaceId)).map((entry) => entry.txId));
        const txB = new Set((await peers.B.store.readTxIndex(graphSpaceId)).map((entry) => entry.txId));

        expect(txA, `seed=${seed}`).toEqual(txB);
        expect(txA, `seed=${seed}`).toEqual(new Set([`rs1-a-${seed}`, `rs1-b-${seed}`]));
      } finally {
        await peers.cleanup();
      }
    }
  });

  it("[INV:CT-RS-2][SURF:V2-RemoteSync] CT-RS-2: duplicate deliveries are idempotent", async ({ task }) => {
    task.meta.invariantId = "CT-RS-2";
    task.meta.surface = "V2-RemoteSync";
    task.meta.oracle = "Across deterministic seeds [1..5], applying the same replication envelope twice does not create extra tx nor divergence.";
    task.meta.criticality = "Critical";

    for (const seed of seeds) {
      const peers = await makeSimPeers(backend);
      const graphSpaceId = `space-v2-rs-2-${seed}`;
      try {
        const envelope = makeEnvelope(graphSpaceId, `rs2-a-${seed}`, `rs2-idem-a-${seed}`, { marker: seed });
        await peers.A.store.appendTx(graphSpaceId, envelope.txBundle, envelope.idempotencyCtx);

        const first = await applyReplicatedTx(peers.B, envelope);
        const second = await applyReplicatedTx(peers.B, envelope);

        expect(first.status, `seed=${seed}`).toBe("committed");
        expect(second.status, `seed=${seed}`).toBe("committed");

        const txIndex = await peers.B.store.readTxIndex(graphSpaceId);
        expect(txIndex, `seed=${seed}`).toHaveLength(1);
        expect(txIndex[0]?.txId, `seed=${seed}`).toBe(`rs2-a-${seed}`);
      } finally {
        await peers.cleanup();
      }
    }
  });

  it("[INV:CT-RS-3][SURF:V2-RemoteSync] CT-RS-3: principal cursor remains monotone with disorder", async ({ task }) => {
    task.meta.invariantId = "CT-RS-3";
    task.meta.surface = "V2-RemoteSync";
    task.meta.oracle = "Across deterministic seeds [1..5], consumer polling on replicated peer observes monotone principalCursorAfter under network disorder.";
    task.meta.criticality = "Regression";

    for (const seed of seeds) {
      const peers = await makeSimPeers(backend);
      const graphSpaceId = `space-v2-rs-3-${seed}`;
      const network = makeSimNetwork<TxEnvelope>(seed + 100);
      const harness = new LocalSyncHarness(peers.B.store, graphSpaceId);

      try {
        await peers.A.store.appendTx(
          graphSpaceId,
          { txId: `rs3-a-${seed}`, metaEvents: [], graphEvents: [{ i: 1 }] },
          { actorId: "peer-a", idempotencyKey: `rs3-idem-a-${seed}`, payloadHash: `h3-a-${seed}` }
        );
        await peers.A.store.appendTx(
          graphSpaceId,
          { txId: `rs3-b-${seed}`, metaEvents: [], graphEvents: [{ i: 2 }] },
          { actorId: "peer-a", idempotencyKey: `rs3-idem-b-${seed}`, payloadHash: `h3-b-${seed}` }
        );

        network.send({ from: "A", to: "B", payload: makeEnvelope(graphSpaceId, `rs3-a-${seed}`, `rs3-idem-a-${seed}`, { i: 1 }) });
        network.send({ from: "A", to: "B", payload: makeEnvelope(graphSpaceId, `rs3-b-${seed}`, `rs3-idem-b-${seed}`, { i: 2 }) });
        network.duplicate(0.5);
        network.reorder();

        let cursor = 0;
        const observedCursors: number[] = [cursor];
        for (let tick = 0; tick < 20 && network.pending() > 0; tick += 1) {
          const message = network.tick();
          if (!message) continue;
          await applyReplicatedTx(peers.B, message.payload);
          const poll = await harness.poll({ principalId: "alice" }, cursor, 1);
          cursor = poll.principalCursorAfter;
          observedCursors.push(cursor);
        }

        for (let i = 1; i < observedCursors.length; i += 1) {
          expect(observedCursors[i], `seed=${seed}`).toBeGreaterThanOrEqual(observedCursors[i - 1]);
        }

        const final = await harness.poll({ principalId: "alice" }, 0, 10);
        expect(new Set(final.txIds), `seed=${seed}`).toEqual(new Set([`rs3-a-${seed}`, `rs3-b-${seed}`]));
      } finally {
        await peers.cleanup();
      }
    }
  });
});

function makeEnvelope(
  graphSpaceId: string,
  txId: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): TxEnvelope {
  const txBundle: TxBundle = { txId, metaEvents: [], graphEvents: [payload] };
  const idempotencyCtx: IdempotencyCtx = {
    actorId: "replicator",
    idempotencyKey,
    payloadHash: JSON.stringify(txBundle)
  };

  return {
    graphSpaceId,
    txBundle,
    idempotencyCtx
  };
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import type { LocalEventStore } from "@mesh/eventstore-local";
import type { Command, CommandOutcome, PrincipalContext, TxBundle } from "@mesh/shared";
import { SyncHttpReferenceServer } from "@mesh/sync-http";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";

interface SubmitResult {
  ackTransport: { accepted: true; idempotencyKey: string };
  final: Promise<CommandOutcome>;
}

interface LocalSyncGatewayLike {
  submit(graphSpaceId: string, principal: PrincipalContext, command: Command, idempotencyKey?: string): SubmitResult;
  syncPull(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitBytes?: number; limitTx?: number }
  ): Promise<{ txBundlesVisible: Array<{ principalCursor: number; txBundle: { txId: string; graphEvents: unknown[] } }>; cursorAfterVisible: number }>;
  syncSubscribe(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitBytes?: number; limitTx?: number; pollIntervalMs?: number; heartbeatEveryMs?: number }
  ): AsyncIterable<unknown>;
  eventsRead(
    graphSpaceId: string,
    principal: PrincipalContext,
    stream: "meta" | "graph",
    fromSeqExclusive: number,
    options?: { limitEvents?: number; limitBytes?: number }
  ): Promise<Array<{ txId: string; seq: number }>>;
  syncPoll(
    graphSpaceId: string,
    principal: PrincipalContext,
    cursor: { metaSeq: number; graphSeq: number },
    options?: { metaLimitEvents?: number; graphLimitEvents?: number; metaLimitBytes?: number; graphLimitBytes?: number }
  ): Promise<{ meta: unknown[]; graph: Array<{ txId: string; seq: number }>; cursorAfter: { metaSeq: number; graphSeq: number } }>;
}

type GatewayCtor = new (
  store: LocalEventStore,
  config: { graphSpaceId: string; executeCommand: (command: Command) => Promise<CommandOutcome> }
) => LocalSyncGatewayLike;

async function loadLocalSyncGatewayCtor(): Promise<GatewayCtor> {
  const moduleHref = new URL("../../sync-local/src/internal/transportGateway.ts", import.meta.url).href;
  const loaded = (await import(moduleHref)) as { LocalSyncGateway: GatewayCtor };
  return loaded.LocalSyncGateway;
}

describe.each(getConformanceBackends())("CT-HTTP-RECOVERY-* (%s)", (backend: ConformanceBackend) => {
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

  it("[INV:CT-HTTP-RECOVERY-1][SURF:Transport] gap recovery via events:read converges to canonical visible stream", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-RECOVERY-1";
    task.meta.surface = "Transport";
    task.meta.oracle = "Gap detected in best-effort delivery can be repaired via events:read with final visible state convergence.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-recovery-gap";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await kernel.execute({ graphSpaceId, commandId: "r-gap-1", actorId: "writer", idempotencyKey: "rg1", payload: { n: 1 } });
    await kernel.execute({ graphSpaceId, commandId: "r-gap-2", actorId: "writer", idempotencyKey: "rg2", payload: { n: 2 } });
    await kernel.execute({ graphSpaceId, commandId: "r-gap-3", actorId: "writer", idempotencyKey: "rg3", payload: { n: 3 } });

    const { url } = await server.listen();
    try {
      const baseline = await readEvents(url, graphSpaceId, "graph", 0, 16);
      expect(baseline.map((event) => event.seq)).toEqual([1, 2, 3]);

      const localDelivered = [baseline[0]!, baseline[2]!];
      expect(localDelivered[1]!.seq).toBeGreaterThan(localDelivered[0]!.seq + 1);

      const recovered = await readEvents(url, graphSpaceId, "graph", localDelivered[0]!.seq, 16);
      const merged = dedupeBySeq([...localDelivered, ...recovered]);

      expect(merged.map((event) => event.txId)).toEqual(baseline.map((event) => event.txId));
      expect(merged.map((event) => event.seq)).toEqual([1, 2, 3]);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-RECOVERY-2][SURF:Transport] cursor mismatch fallback sync:poll converges without fragile timing", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-RECOVERY-2";
    task.meta.surface = "Transport";
    task.meta.oracle = "On cursorBefore mismatch, client fallback to sync:poll from durable local cursor converges to canonical visible state.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-recovery-mismatch";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await kernel.execute({ graphSpaceId, commandId: "r-mismatch-1", actorId: "writer", idempotencyKey: "rm1", payload: { n: 1 } });
    await kernel.execute({ graphSpaceId, commandId: "r-mismatch-2", actorId: "writer", idempotencyKey: "rm2", payload: { n: 2 } });

    const { url } = await server.listen();
    try {
      const localCursor = { metaSeq: 0, graphSeq: 0 };
      const incomingDeltaCursorBefore = { metaSeq: 0, graphSeq: 1 };
      const mismatch =
        incomingDeltaCursorBefore.metaSeq !== localCursor.metaSeq ||
        incomingDeltaCursorBefore.graphSeq !== localCursor.graphSeq;
      expect(mismatch).toBe(true);

      const pollRecovered = await poll(url, graphSpaceId, localCursor, { meta: 8, graph: 8 });
      const baseline = await readEvents(url, graphSpaceId, "graph", 0, 16);

      const recoveredGraph = dedupeBySeq(pollRecovered.graph);
      expect(recoveredGraph.map((event) => event.txId)).toEqual(baseline.map((event) => event.txId));
      expect(pollRecovered.cursorAfter.graphSeq).toBe(2);
      expect(pollRecovered.cursorAfter.metaSeq).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-RECOVERY-3][SURF:Transport] events:read and sync:poll preserve tx-closed boundaries under limits", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-RECOVERY-3";
    task.meta.surface = "Transport";
    task.meta.oracle = "Recovery endpoints never cut inside a transaction even when event/bytes limits are tight.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-recovery-tx-closed";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await appendRawTx(store, graphSpaceId, "raw-tx-1", {
      metaEvents: [],
      graphEvents: [{ n: 1 }, { n: 2 }]
    });
    await kernel.execute({ graphSpaceId, commandId: "raw-tx-2", actorId: "writer", idempotencyKey: "rtx2", payload: { n: 3 } });

    const { url } = await server.listen();
    try {
      const readLimited = await readEvents(url, graphSpaceId, "graph", 0, 1);
      expect(readLimited).toHaveLength(2);
      expect(new Set(readLimited.map((event) => event.txId)).size).toBe(1);
      expect(readLimited.map((event) => event.seq)).toEqual([1, 2]);

      const pollLimited = await poll(url, graphSpaceId, { metaSeq: 0, graphSeq: 0 }, { graph: 1, meta: 1 });
      expect(pollLimited.graph).toHaveLength(2);
      expect(new Set(pollLimited.graph.map((event) => event.txId)).size).toBe(1);
      expect(pollLimited.cursorAfter.graphSeq).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-RECOVERY-4][SURF:Transport] recovery endpoints keep absent-vs-masked indistinguishable", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-RECOVERY-4";
    task.meta.surface = "Transport";
    task.meta.oracle =
      "events:read/sync:poll preserve user-safe indistinguishability between absent and masked transactions (status/payload/cursor/errors).";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-recovery-mask";
    const absentStore = store;
    const maskedScope = await makeStore(backend);

    try {
      const absentKernel = new KernelMinimalImpl(absentStore);
      const maskedKernel = new KernelMinimalImpl(maskedScope.store);
      const Gateway = await loadLocalSyncGatewayCtor();
      const absentGateway = new Gateway(absentStore, { graphSpaceId, executeCommand: (command) => absentKernel.execute(command) });
      const maskedGateway = new Gateway(maskedScope.store, { graphSpaceId, executeCommand: (command) => maskedKernel.execute(command) });
      const absentServer = new SyncHttpReferenceServer({ graphSpaceId, gateway: absentGateway });
      const maskedServer = new SyncHttpReferenceServer({ graphSpaceId, gateway: maskedGateway });

      await absentKernel.execute({ graphSpaceId, commandId: "r-mask-visible", actorId: "writer", idempotencyKey: "rmv-a", payload: { n: 1 } });
      await maskedKernel.execute({ graphSpaceId, commandId: "r-mask-visible", actorId: "writer", idempotencyKey: "rmv-m", payload: { n: 1 } });
      await maskedKernel.execute({
        graphSpaceId,
        commandId: "r-mask-hidden",
        actorId: "writer",
        idempotencyKey: "rmh-m",
        payload: { n: 999, _acl: { alice: "mask" } }
      });

      const absentListen = await absentServer.listen();
      const maskedListen = await maskedServer.listen();

      try {
        const absentEvents = await fetch(`${absentListen.url}/v1/${graphSpaceId}/events:read?stream=graph&fromSeqExclusive=0&limit=16`, {
          headers: { "x-mesh-principal": "alice" }
        });
        const maskedEvents = await fetch(`${maskedListen.url}/v1/${graphSpaceId}/events:read?stream=graph&fromSeqExclusive=0&limit=16`, {
          headers: { "x-mesh-principal": "alice" }
        });
        expect(maskedEvents.status).toBe(absentEvents.status);
        expect(await maskedEvents.json()).toEqual(await absentEvents.json());

        const cursorParam = encodeURIComponent(JSON.stringify({ metaSeq: 0, graphSeq: 0 }));
        const limitsParam = encodeURIComponent(JSON.stringify({ meta: 4, graph: 4 }));
        const absentPoll = await fetch(`${absentListen.url}/v1/${graphSpaceId}/sync:poll?cursor=${cursorParam}&limits=${limitsParam}`, {
          headers: { "x-mesh-principal": "alice" }
        });
        const maskedPoll = await fetch(`${maskedListen.url}/v1/${graphSpaceId}/sync:poll?cursor=${cursorParam}&limits=${limitsParam}`, {
          headers: { "x-mesh-principal": "alice" }
        });
        expect(maskedPoll.status).toBe(absentPoll.status);
        expect(await maskedPoll.json()).toEqual(await absentPoll.json());

        const absentInvalid = await fetch(`${absentListen.url}/v1/${graphSpaceId}/events:read?stream=bad&fromSeqExclusive=0&limit=4`, {
          headers: { "x-mesh-principal": "alice" }
        });
        const maskedInvalid = await fetch(`${maskedListen.url}/v1/${graphSpaceId}/events:read?stream=bad&fromSeqExclusive=0&limit=4`, {
          headers: { "x-mesh-principal": "alice" }
        });
        expect(maskedInvalid.status).toBe(absentInvalid.status);
        expect(await maskedInvalid.json()).toEqual(await absentInvalid.json());
      } finally {
        await absentServer.close();
        await maskedServer.close();
      }
    } finally {
      await maskedScope.cleanup();
    }
  });

  it("[INV:CT-SYNC-4][SURF:Transport] sync:poll never exposes cross-stream partial tx visibility", async ({ task }) => {
    task.meta.invariantId = "CT-SYNC-4";
    task.meta.surface = "Transport";
    task.meta.oracle =
      "sync:poll must keep meta/graph co-visible per tx and never advance cursor beyond a tx whose other stream part is missing.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-recovery-cross-stream-atomicity";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await appendRawTx(store, graphSpaceId, "raw-tx-both-streams", {
      metaEvents: [{ kind: "tag", value: "m1" }],
      graphEvents: [{ n: 1 }]
    });

    const { url } = await server.listen();
    try {
      const polled = await poll(url, graphSpaceId, { metaSeq: 0, graphSeq: 1 }, { meta: 1, graph: 1 });
      expect(polled.meta).toEqual([]);
      expect(polled.graph).toEqual([]);
      expect(polled.cursorAfter).toEqual({ metaSeq: 0, graphSeq: 1 });
    } finally {
      await server.close();
    }
  });
});

async function readEvents(
  baseUrl: string,
  graphSpaceId: string,
  stream: "meta" | "graph",
  fromSeqExclusive: number,
  limit: number
): Promise<Array<{ txId: string; seq: number }>> {
  const response = await fetch(
    `${baseUrl}/v1/${graphSpaceId}/events:read?stream=${stream}&fromSeqExclusive=${fromSeqExclusive}&limit=${limit}`,
    {
      headers: { "x-mesh-principal": "alice" }
    }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Array<{ txId: string; seq: number }>;
}

async function poll(
  baseUrl: string,
  graphSpaceId: string,
  cursor: { metaSeq: number; graphSeq: number },
  limits: { meta: number; graph: number }
): Promise<{ meta: Array<{ txId: string; seq: number }>; graph: Array<{ txId: string; seq: number }>; cursorAfter: { metaSeq: number; graphSeq: number } }> {
  const cursorParam = encodeURIComponent(JSON.stringify(cursor));
  const limitsParam = encodeURIComponent(JSON.stringify(limits));
  const response = await fetch(`${baseUrl}/v1/${graphSpaceId}/sync:poll?cursor=${cursorParam}&limits=${limitsParam}`, {
    headers: { "x-mesh-principal": "alice" }
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { meta: Array<{ txId: string; seq: number }>; graph: Array<{ txId: string; seq: number }>; cursorAfter: { metaSeq: number; graphSeq: number } };
}

async function appendRawTx(
  store: LocalEventStore,
  graphSpaceId: string,
  txId: string,
  bundle: Pick<TxBundle, "metaEvents" | "graphEvents">
): Promise<void> {
  const outcome = await store.appendTx(
    graphSpaceId,
    {
      txId,
      metaEvents: bundle.metaEvents,
      graphEvents: bundle.graphEvents
    },
    {
      actorId: "writer",
      idempotencyKey: `${txId}-idem`,
      payloadHash: `${txId}-payload-hash`
    }
  );

  if (outcome.status !== "committed") {
    throw new Error(`appendRawTx failed: ${outcome.reasonCode}`);
  }
}

function dedupeBySeq(events: Array<{ txId: string; seq: number }>): Array<{ txId: string; seq: number }> {
  const output: Array<{ txId: string; seq: number }> = [];
  const seen = new Set<number>();
  for (const event of events) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    output.push(event);
  }
  return output.sort((a, b) => a.seq - b.seq);
}

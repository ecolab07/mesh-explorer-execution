import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import type { LocalEventStore } from "@mesh/eventstore-local";
import type { Command, CommandOutcome, PrincipalContext } from "@mesh/shared";
import { SyncHttpReferenceServer } from "@mesh/sync-http";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";

interface SubmitResult {
  ackTransport: { accepted: true; idempotencyKey: string };
  final: Promise<CommandOutcome>;
}

interface SyncFrame {
  kind: "txBundles" | "heartbeat" | "cursor";
  txBundlesVisible?: Array<{ principalCursor: number; txBundle: { txId: string } }>;
  cursorVisible?: number;
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
  ): AsyncIterable<SyncFrame>;
  eventsRead(
    graphSpaceId: string,
    principal: PrincipalContext,
    stream: "meta" | "graph",
    fromSeqExclusive: number,
    options?: { limitEvents?: number; limitBytes?: number }
  ): Promise<unknown[]>;
  syncPoll(
    graphSpaceId: string,
    principal: PrincipalContext,
    cursor: { metaSeq: number; graphSeq: number },
    options?: { metaLimitEvents?: number; graphLimitEvents?: number; metaLimitBytes?: number; graphLimitBytes?: number }
  ): Promise<{ meta: unknown[]; graph: unknown[]; cursorAfter: { metaSeq: number; graphSeq: number } }>;
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

describe.each(getConformanceBackends())("CT-HTTP-TRANSPORT-* (%s)", (backend: ConformanceBackend) => {
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

  it("[INV:CT-HTTP-TRANSPORT-1][SURF:Transport] submit retry after client-timeout returns same final receipt", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-TRANSPORT-1";
    task.meta.surface = "Transport";
    task.meta.oracle = "HTTP timeout/lost response then retry with same idempotencyKey yields same final receipt and no double-commit.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-submit";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway, submitResponseDelayMs: 150 });

    const command: Command = {
      graphSpaceId,
      commandId: "http-cmd-1",
      actorId: "writer",
      idempotencyKey: "http-idem-1",
      payload: { n: 1 }
    };

    const { url } = await server.listen();
    try {
      const aborter = new AbortController();
      setTimeout(() => aborter.abort(), 30);
      await expect(
        fetch(`${url}/v1/${graphSpaceId}/commands:submit`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-mesh-principal": "alice"
          },
          body: JSON.stringify(command),
          signal: aborter.signal
        })
      ).rejects.toThrow();

      const retry = await fetch(`${url}/v1/${graphSpaceId}/commands:submit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mesh-principal": "alice"
        },
        body: JSON.stringify(command)
      });

      const retriedOutcome = (await retry.json()) as CommandOutcome;
      expect(retriedOutcome.status).toBe("committed");
      expect((await store.readTxIndex(graphSpaceId)).map((entry) => entry.txId)).toEqual(["http-cmd-1"]);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-TRANSPORT-2][SURF:Transport] pull cursor monotone and tx-closed", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-TRANSPORT-2";
    task.meta.surface = "Transport";
    task.meta.oracle = "HTTP sync:pull remains cursor-monotone, hole-free for visible tx, and tx-closed.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-pull";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await kernel.execute({ graphSpaceId, commandId: "http-pull-1", actorId: "writer", idempotencyKey: "hp1", payload: { n: 1 } });
    await kernel.execute({ graphSpaceId, commandId: "http-pull-hidden", actorId: "writer", idempotencyKey: "hp2", payload: { n: 2, _acl: { alice: "mask" } } });
    await kernel.execute({ graphSpaceId, commandId: "http-pull-2", actorId: "writer", idempotencyKey: "hp3", payload: { n: 3 } });

    const { url } = await server.listen();
    try {
      const firstRes = await fetch(`${url}/v1/${graphSpaceId}/sync:pull?from=0&limitTx=1&limitBytes=1`, {
        headers: { "x-mesh-principal": "alice" }
      });
      const first = (await firstRes.json()) as { txBundlesVisible: Array<{ txBundle: { txId: string; graphEvents: unknown[] } }>; cursorAfterVisible: number };

      const secondRes = await fetch(`${url}/v1/${graphSpaceId}/sync:pull?from=${first.cursorAfterVisible}&limitTx=10&limitBytes=1024`, {
        headers: { "x-mesh-principal": "alice" }
      });
      const second = (await secondRes.json()) as { txBundlesVisible: Array<{ txBundle: { txId: string; graphEvents: unknown[] } }>; cursorAfterVisible: number };

      expect(first.txBundlesVisible.map((tx) => tx.txBundle.txId)).toEqual(["http-pull-1"]);
      expect(second.txBundlesVisible.map((tx) => tx.txBundle.txId)).toEqual(["http-pull-2"]);
      expect(first.txBundlesVisible[0]?.txBundle.graphEvents.length).toBeGreaterThan(0);
      expect(second.txBundlesVisible[0]?.txBundle.graphEvents.length).toBeGreaterThan(0);
      expect(second.cursorAfterVisible).toBeGreaterThanOrEqual(first.cursorAfterVisible);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-TRANSPORT-3][SURF:Transport] SSE subscribe reconnect from cursor converges", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-TRANSPORT-3";
    task.meta.surface = "Transport";
    task.meta.oracle = "SSE reconnection from last cursor converges to same visible state (duplicates tolerated).";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-http-subscribe";
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const server = new SyncHttpReferenceServer({ graphSpaceId, gateway });

    await kernel.execute({ graphSpaceId, commandId: "http-sub-1", actorId: "writer", idempotencyKey: "hs1", payload: { n: 1 } });
    await kernel.execute({ graphSpaceId, commandId: "http-sub-2", actorId: "writer", idempotencyKey: "hs2", payload: { n: 2 } });

    const { url } = await server.listen();
    try {
      const beforeDisconnect = await collectFromSse(url, graphSpaceId, 0, 2);
      await kernel.execute({ graphSpaceId, commandId: "http-sub-3", actorId: "writer", idempotencyKey: "hs3", payload: { n: 3 } });
      const afterReconnect = await collectFromSse(url, graphSpaceId, beforeDisconnect.cursor, 3);
      const txIds = dedupe([...beforeDisconnect.txIds, ...afterReconnect.txIds]);

      expect(txIds).toEqual(["http-sub-1", "http-sub-2", "http-sub-3"]);
      expect(afterReconnect.cursor).toBe(3);
    } finally {
      await server.close();
    }
  });

  it("[INV:CT-HTTP-TRANSPORT-4][SURF:Transport] absent vs masked indistinguishable on status/body/cursor", async ({ task }) => {
    task.meta.invariantId = "CT-HTTP-TRANSPORT-4";
    task.meta.surface = "Transport";
    task.meta.oracle = "HTTP surfaces (status/body/cursor) do not distinguish absent from masked data for same principal.";
    task.meta.criticality = "Structural";

    const graphSpaceId = "space-http-mask";
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

      await absentKernel.execute({ graphSpaceId, commandId: "http-visible", actorId: "writer", idempotencyKey: "hm-a-1", payload: { n: 1 } });
      await maskedKernel.execute({ graphSpaceId, commandId: "http-visible", actorId: "writer", idempotencyKey: "hm-m-1", payload: { n: 1 } });
      await maskedKernel.execute({ graphSpaceId, commandId: "http-masked", actorId: "writer", idempotencyKey: "hm-m-2", payload: { n: 99, _acl: { alice: "mask" } } });

      const absentListen = await absentServer.listen();
      const maskedListen = await maskedServer.listen();
      try {
        const absentPull = await fetch(`${absentListen.url}/v1/${graphSpaceId}/sync:pull?from=0&limitTx=8`, {
          headers: { "x-mesh-principal": "alice" }
        });
        const maskedPull = await fetch(`${maskedListen.url}/v1/${graphSpaceId}/sync:pull?from=0&limitTx=8`, {
          headers: { "x-mesh-principal": "alice" }
        });

        expect(maskedPull.status).toBe(absentPull.status);
        const absentPullBody = await absentPull.json();
        const maskedPullBody = await maskedPull.json();
        expect(maskedPullBody).toEqual(absentPullBody);

        const absentSse = await collectFromSse(absentListen.url, graphSpaceId, 0, 1);
        const maskedSse = await collectFromSse(maskedListen.url, graphSpaceId, 0, 1);
        expect(maskedSse.cursor).toBe(absentSse.cursor);
        expect(maskedSse.txIds).toEqual(absentSse.txIds);
      } finally {
        await absentServer.close();
        await maskedServer.close();
      }
    } finally {
      await maskedScope.cleanup();
    }
  });
});

async function collectFromSse(
  baseUrl: string,
  graphSpaceId: string,
  fromCursor: number,
  targetCursor: number
): Promise<{ txIds: string[]; cursor: number }> {
  const txIds: string[] = [];
  const aborter = new AbortController();
  const response = await fetch(`${baseUrl}/v1/${graphSpaceId}/sync:subscribe?from=${fromCursor}&heartbeatMs=20`, {
    headers: { "x-mesh-principal": "alice" },
    signal: aborter.signal
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) {
    throw new Error("SSE stream missing");
  }

  let cursor = fromCursor;
  let buffer = "";
  for (let round = 0; round < 200; round += 1) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n\n")) {
      const splitAt = buffer.indexOf("\n\n");
      const frame = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine.slice(6)) as SyncFrame;

      if (payload.kind === "txBundles") {
        txIds.push(...(payload.txBundlesVisible ?? []).map((tx) => tx.txBundle.txId));
      }
      if (payload.kind === "cursor") {
        cursor = payload.cursorVisible ?? cursor;
        if (cursor >= targetCursor) {
          aborter.abort();
          return { txIds, cursor };
        }
      }
    }
  }

  aborter.abort();
  return { txIds, cursor };
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

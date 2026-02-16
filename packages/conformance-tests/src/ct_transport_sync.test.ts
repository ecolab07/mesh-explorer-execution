import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import type { Command, CommandOutcome, PrincipalContext } from "@mesh/shared";

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

describe.each(getConformanceBackends())("CT-TRANSPORT-* sync transport v1 (%s)", (backend: ConformanceBackend) => {
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

  it("[INV:CT-TRANSPORT-1][SURF:Transport] submit retry with same idempotencyKey keeps single commit", async ({ task }) => {
    task.meta.invariantId = "CT-TRANSPORT-1";
    task.meta.surface = "Transport";
    task.meta.oracle = "Lost ack/receipt then retry with same idempotency key returns same committed receipt and no duplicate commit.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-transport-submit";
    const principal = { principalId: "alice" };
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });

    const command: Command = {
      graphSpaceId,
      commandId: "cmd-transport-1",
      actorId: "writer",
      idempotencyKey: "idem-transport-1",
      payload: { op: "SET", n: 1 }
    };

    const first = gateway.submit(graphSpaceId, principal, command, command.idempotencyKey);
    expect(first.ackTransport.accepted).toBe(true);

    const second = gateway.submit(graphSpaceId, principal, command, command.idempotencyKey);
    const firstFinal = await first.final;
    const secondFinal = await second.final;

    expect(firstFinal.status).toBe("committed");
    expect(secondFinal).toEqual(firstFinal);
    expect((await store.readTxIndex(graphSpaceId)).map((entry) => entry.txId)).toEqual(["cmd-transport-1"]);
  });

  it("[INV:CT-TRANSPORT-2][SURF:Transport] syncPull cursor monotone and tx-closed", async ({ task }) => {
    task.meta.invariantId = "CT-TRANSPORT-2";
    task.meta.surface = "Transport";
    task.meta.oracle = "syncPull never regresses cursor, shows no visible holes, and always returns tx-closed bundles.";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-transport-pull";
    const principal = { principalId: "alice" };
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });

    await kernel.execute({ graphSpaceId, commandId: "t2-cmd-1", actorId: "writer", idempotencyKey: "t2-k1", payload: { node: "a" } });
    await kernel.execute({ graphSpaceId, commandId: "t2-cmd-hidden", actorId: "writer", idempotencyKey: "t2-kh", payload: { node: "x", _acl: { alice: "mask" } } });
    await kernel.execute({ graphSpaceId, commandId: "t2-cmd-2", actorId: "writer", idempotencyKey: "t2-k2", payload: { node: "b" } });

    const first = await gateway.syncPull(graphSpaceId, principal, 0, { limitTx: 1, limitBytes: 1 });
    const second = await gateway.syncPull(graphSpaceId, principal, first.cursorAfterVisible, { limitTx: 10, limitBytes: 1024 });

    expect(first.txBundlesVisible.map((tx) => tx.txBundle.txId)).toEqual(["t2-cmd-1"]);
    expect(second.txBundlesVisible.map((tx) => tx.txBundle.txId)).toEqual(["t2-cmd-2"]);
    expect(first.txBundlesVisible[0]?.txBundle.graphEvents.length).toBeGreaterThan(0);
    expect(second.txBundlesVisible[0]?.txBundle.graphEvents.length).toBeGreaterThan(0);
    expect(second.cursorAfterVisible).toBeGreaterThanOrEqual(first.cursorAfterVisible);
  });

  it("[INV:CT-TRANSPORT-3][SURF:Transport] subscribe reconnect from visible cursor converges", async ({ task }) => {
    task.meta.invariantId = "CT-TRANSPORT-3";
    task.meta.surface = "Transport";
    task.meta.oracle = "After disconnect and cursor-based resume, final visible state converges (duplicates tolerated).";
    task.meta.criticality = "Critical";

    const graphSpaceId = "space-transport-subscribe";
    const principal = { principalId: "alice" };
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });

    await kernel.execute({ graphSpaceId, commandId: "t3-cmd-1", actorId: "writer", idempotencyKey: "t3-k1", payload: { n: 1 } });
    await kernel.execute({ graphSpaceId, commandId: "t3-cmd-2", actorId: "writer", idempotencyKey: "t3-k2", payload: { n: 2 } });

    const beforeDisconnect = await collectFromSubscribe(gateway, graphSpaceId, principal, 0, 2);
    const reconnectCursor = beforeDisconnect.cursor;

    await kernel.execute({ graphSpaceId, commandId: "t3-cmd-3", actorId: "writer", idempotencyKey: "t3-k3", payload: { n: 3 } });

    const afterReconnect = await collectFromSubscribe(gateway, graphSpaceId, principal, reconnectCursor, 3);
    const combined = dedupe([...beforeDisconnect.txIds, ...afterReconnect.txIds]);

    expect(combined).toEqual(["t3-cmd-1", "t3-cmd-2", "t3-cmd-3"]);
    expect(afterReconnect.cursor).toBe(3);
  });

  it("[INV:CT-TRANSPORT-4][SURF:Transport] masked vs absent indistinguishable via pull/subscribe cursors", async ({ task }) => {
    task.meta.invariantId = "CT-TRANSPORT-4";
    task.meta.surface = "Transport";
    task.meta.oracle = "Transport responses/cursors do not expose absent-vs-masked differences for a principal.";
    task.meta.criticality = "Structural";

    const principal = { principalId: "alice" };
    const graphSpaceId = "space-transport-mask";
    const absentStore = store;
    const maskedScope = await makeStore(backend);
    const maskedStore = maskedScope.store;

    try {
      const absentKernel = new KernelMinimalImpl(absentStore);
      const maskedKernel = new KernelMinimalImpl(maskedStore);
      const Gateway = await loadLocalSyncGatewayCtor();

      const absentGateway = new Gateway(absentStore, { graphSpaceId, executeCommand: (command) => absentKernel.execute(command) });
      const maskedGateway = new Gateway(maskedStore, { graphSpaceId, executeCommand: (command) => maskedKernel.execute(command) });

      await absentKernel.execute({ graphSpaceId, commandId: "t4-visible", actorId: "writer", idempotencyKey: "t4-a-1", payload: { n: 1 } });

      await maskedKernel.execute({ graphSpaceId, commandId: "t4-visible", actorId: "writer", idempotencyKey: "t4-m-1", payload: { n: 1 } });
      await maskedKernel.execute({ graphSpaceId, commandId: "t4-masked", actorId: "writer", idempotencyKey: "t4-m-2", payload: { n: 999, _acl: { alice: "mask" } } });

      const absentPull = await absentGateway.syncPull(graphSpaceId, principal, 0, { limitTx: 8 });
      const maskedPull = await maskedGateway.syncPull(graphSpaceId, principal, 0, { limitTx: 8 });

      expect(absentPull.cursorAfterVisible).toBe(maskedPull.cursorAfterVisible);
      expect(absentPull.txBundlesVisible.map((tx) => tx.txBundle.txId)).toEqual(maskedPull.txBundlesVisible.map((tx) => tx.txBundle.txId));

      const absentSub = await collectFromSubscribe(absentGateway, graphSpaceId, principal, 0, 1);
      const maskedSub = await collectFromSubscribe(maskedGateway, graphSpaceId, principal, 0, 1);
      expect(absentSub.cursor).toBe(maskedSub.cursor);
      expect(absentSub.txIds).toEqual(maskedSub.txIds);
    } finally {
      await maskedScope.cleanup();
    }
  });
});

async function collectFromSubscribe(
  gateway: LocalSyncGatewayLike,
  graphSpaceId: string,
  principal: PrincipalContext,
  fromCursorVisible: number,
  targetCursor: number
): Promise<{ txIds: string[]; cursor: number }> {
  const iterator = gateway
    .syncSubscribe(graphSpaceId, principal, fromCursorVisible, { limitTx: 2, pollIntervalMs: 5, heartbeatEveryMs: 10 })
    [Symbol.asyncIterator]();

  const txIds: string[] = [];
  let cursor = fromCursorVisible;

  for (let rounds = 0; rounds < 100; rounds += 1) {
    const { value, done } = await iterator.next();
    if (done || !value) break;

    if (value.kind === "txBundles") {
      txIds.push(...(value.txBundlesVisible ?? []).map((tx) => tx.txBundle.txId));
    }
    if (value.kind === "cursor") {
      cursor = value.cursorVisible ?? cursor;
      if (cursor >= targetCursor) {
        break;
      }
    }
  }

  await iterator.return?.();
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

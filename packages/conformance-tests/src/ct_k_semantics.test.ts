import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import {
  REASON_CODES,
  type Command,
  type CommandError,
  type Cursor,
  type EventEnvelope,
  type FaultInjectionHooks,
  type IdempotencyCtx,
  type ReadMode,
  type ReadRangeOptions,
  type StreamName,
  type TransactionReceipt,
  type TxIndexEntry,
  type TxBundle,
  type TxId
} from "@mesh/shared";

const baseCommand: Command = {
  graphSpaceId: "space-k",
  commandId: "cmd-1",
  actorId: "actor-k",
  idempotencyKey: "idem-k",
  payload: { op: "SET", value: 1 }
};

describe.each(getConformanceBackends())("CT-K-* Kernel command semantics (%s)", (backend: ConformanceBackend) => {
  let store: LocalEventStore;
  let cleanup: () => Promise<void> = async () => {};

  beforeEach(async () => {
    const scope = await makeStore(backend);
    store = scope.store;
    cleanup = scope.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("[INV:CT-K-1][SURF:Kernel] CT-K-1: receipt determinism (idempotent retry)", async ({ task }) => {
    task.meta.invariantId = "CT-K-1";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Replaying the same actorId+idempotencyKey+payload returns the original committed receipt exactly.";
    task.meta.criticality = "Structural";
    const kernel = new KernelMinimalImpl(store);

    const first = await kernel.execute({ ...baseCommand, commandId: "cmd-k1" });
    const second = await kernel.execute({ ...baseCommand, commandId: "cmd-k1-replayed" });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "committed",
      txId: "cmd-k1",
      txIndex: 1,
      cursorAfter: { metaSeq: 0, graphSeq: 1 }
    });
  });

  it("[INV:CT-K-2][SURF:Kernel] CT-K-2: idempotency mismatch reject", async ({ task }) => {
    task.meta.invariantId = "CT-K-2";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Reusing the same idempotency key with different payload rejects with CONFLICT/IDEMPOTENCY_PAYLOAD_MISMATCH.";
    task.meta.criticality = "Critical";
    const kernel = new KernelMinimalImpl(store);

    const accepted = await kernel.execute({ ...baseCommand, commandId: "cmd-k2-ok" });
    const rejected = await kernel.execute({ ...baseCommand, commandId: "cmd-k2-conflict", payload: { op: "SET", value: 999 } });

    expect(accepted).toMatchObject({ status: "committed", txId: "cmd-k2-ok", txIndex: 1 });
    expect(rejected).toEqual({
      status: "rejected",
      category: "CONFLICT",
      reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH
    });
  });

  it("[INV:CT-K-3][SURF:Kernel] CT-K-3: precondition mismatch is propagated", async ({ task }) => {
    task.meta.invariantId = "CT-K-3";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Append-layer PRECONDITION/REVISION_MISMATCH is propagated by kernel without remapping.";
    task.meta.criticality = "Critical";
    const fakeStore = new RevisionMismatchStore();
    const kernel = new KernelMinimalImpl(fakeStore);

    const result = await kernel.execute({ ...baseCommand, commandId: "cmd-k3", requireBaseRevision: "rev/current" });

    expect(fakeStore.resolveRevisionCalls).toEqual([["space-k", "rev/current"]]);
    expect(fakeStore.appendCalls).toHaveLength(1);
    expect(result).toEqual({
      status: "rejected",
      category: "PRECONDITION",
      reasonCode: REASON_CODES.REVISION_MISMATCH,
      commandId: "cmd-k3"
    });
  });

  it("[INV:CT-K-4][SURF:Kernel] CT-K-4: fault injection abort safety via kernel", async ({ task }) => {
    task.meta.invariantId = "CT-K-4";
    task.meta.surface = "Kernel";
    task.meta.oracle = "A BEFORE_IDB_COMMIT fault during kernel execute must abort atomically, leaving no partial writes.";
    task.meta.criticality = "Critical";
    const faultedStore = new FailBeforeCommitStore(store);
    const kernel = new KernelMinimalImpl(faultedStore);

    await expect(kernel.execute({ ...baseCommand, graphSpaceId: "space-k4", commandId: "cmd-k4", idempotencyKey: "idem-k4" })).rejects.toThrowError(
      "FAULT_INJECTION:BEFORE_IDB_COMMIT"
    );

    const meta = await store.readRange("space-k4", "meta", 0, 100, "TX_CLOSED");
    const graph = await store.readRange("space-k4", "graph", 0, 100, "TX_CLOSED");
    const txIndex = await store.readTxIndex("space-k4");

    expect(meta).toEqual([]);
    expect(graph).toEqual([]);
    expect(txIndex).toEqual([]);

    const retryKernel = new KernelMinimalImpl(store);
    const retry = await retryKernel.execute({ ...baseCommand, graphSpaceId: "space-k4", commandId: "cmd-k4", idempotencyKey: "idem-k4" });
    expect(retry).toMatchObject({ status: "committed", txId: "cmd-k4", txIndex: 1 });
  });
});

class RevisionMismatchStore implements LocalEventStore {
  resolveRevisionCalls: Array<[string, string]> = [];
  appendCalls: Array<{ graphSpaceId: string; txBundle: TxBundle; idempotencyCtx: IdempotencyCtx }> = [];

  async appendTx(graphSpaceId: string, txBundle: TxBundle, idempotencyCtx: IdempotencyCtx): Promise<TransactionReceipt | CommandError> {
    this.appendCalls.push({ graphSpaceId, txBundle, idempotencyCtx });
    return {
      status: "rejected",
      category: "PRECONDITION",
      reasonCode: REASON_CODES.REVISION_MISMATCH,
      commandId: txBundle.txId
    };
  }

  async readTx(_graphSpaceId: string, _txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    return null;
  }

  async readTxForPrincipal(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError> {
    const tx = await this.readTx(graphSpaceId, txId);
    return tx ?? { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
  }

  async readRange(
    _graphSpaceId: string,
    _stream: StreamName,
    _fromSeqExclusive: number,
    _limit: number,
    _mode: ReadMode,
    _options?: ReadRangeOptions
  ): Promise<EventEnvelope[]> {
    return [];
  }

  async readTxIndex(_graphSpaceId: string): Promise<TxIndexEntry[]> {
    return [];
  }

  async getCursorHead(_graphSpaceId: string): Promise<Cursor> {
    return { metaSeq: 0, graphSeq: 0 };
  }

  async readPrincipalTxRange(
    _graphSpaceId: string,
    fromPrincipalCursorExclusive: number,
    _limit: number
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }> {
    return { txs: [], cursor: fromPrincipalCursorExclusive };
  }

  async getPrincipalCursorHead(_graphSpaceId: string): Promise<number> {
    return 0;
  }

  async resolveRevision(graphSpaceId: string, revisionToken: string): Promise<Cursor | null> {
    this.resolveRevisionCalls.push([graphSpaceId, revisionToken]);
    return { metaSeq: 0, graphSeq: 0 };
  }

  async compactUpToCursor(_params: { graphSpaceId: string; cursorExclusive: number }): Promise<void> {
    return;
  }
}

class FailBeforeCommitStore implements LocalEventStore {
  private fired = false;
  constructor(private readonly inner: LocalEventStore) {}

  appendTx(graphSpaceId: string, txBundle: TxBundle, idempotencyCtx: IdempotencyCtx): Promise<TransactionReceipt | CommandError> {
    const hooks: FaultInjectionHooks | undefined = this.fired ? undefined : { failAt: "BEFORE_IDB_COMMIT" };
    this.fired = true;
    return this.inner.appendTx(graphSpaceId, txBundle, idempotencyCtx, hooks);
  }

  readTx(graphSpaceId: string, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null> {
    return this.inner.readTx(graphSpaceId, txId);
  }

  readTxForPrincipal(
    graphSpaceId: string,
    txId: TxId
  ): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError> {
    return this.inner.readTxForPrincipal(graphSpaceId, txId);
  }

  readRange(
    graphSpaceId: string,
    stream: StreamName,
    fromSeqExclusive: number,
    limit: number,
    mode: ReadMode,
    options?: ReadRangeOptions
  ): Promise<EventEnvelope[]> {
    return this.inner.readRange(graphSpaceId, stream, fromSeqExclusive, limit, mode, options);
  }

  readTxIndex(graphSpaceId: string): Promise<TxIndexEntry[]> {
    return this.inner.readTxIndex(graphSpaceId);
  }

  getCursorHead(graphSpaceId: string): Promise<Cursor> {
    return this.inner.getCursorHead(graphSpaceId);
  }

  readPrincipalTxRange(
    graphSpaceId: string,
    fromPrincipalCursorExclusive: number,
    limit: number
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }> {
    return this.inner.readPrincipalTxRange(graphSpaceId, fromPrincipalCursorExclusive, limit);
  }

  getPrincipalCursorHead(graphSpaceId: string): Promise<number> {
    return this.inner.getPrincipalCursorHead(graphSpaceId);
  }

  resolveRevision(graphSpaceId: string, revisionToken: string): Promise<Cursor | null> {
    return this.inner.resolveRevision(graphSpaceId, revisionToken);
  }

  compactUpToCursor(params: { graphSpaceId: string; cursorExclusive: number }): Promise<void> {
    return this.inner.compactUpToCursor(params);
  }
}

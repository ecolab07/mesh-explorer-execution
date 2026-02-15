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
  type IdempotencyCtx,
  type ReadMode,
  type ReadRangeOptions,
  type StreamName,
  type TransactionReceipt,
  type TxIndexEntry,
  type TxBundle,
  type TxId
} from "@mesh/shared";

// Invariant: invalid baseRevision rejects with normalized VALIDATION/INVALID_BASE_REVISION; fail on any other class/code.
// Invariant: idempotent replay with same actor+key+payload returns the exact original committed receipt; fail on divergence.
// Invariant: same idempotency key with different payload rejects as CONFLICT/IDEMPOTENCY_PAYLOAD_MISMATCH; fail if committed.
// Invariant: revision mismatch from append layer is propagated as PRECONDITION/REVISION_MISMATCH; fail on remapping.
// Invariant: malformed command is rejected and never committed; fail if append path accepts it.
const baseCommand: Command = {
  graphSpaceId: "space-k",
  commandId: "cmd-1",
  actorId: "actor-k",
  idempotencyKey: "idem-k",
  payload: { op: "SET", value: 1 }
};

describe.each(getConformanceBackends())("CT-K-* Kernel command semantics (%s)", (backend: ConformanceBackend) => {
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
  it("[INV:CT-K-1][SURF:Kernel] CT-K-1: invalid baseRevision returns normalized error", async ({ task }) => {
    task.meta.invariantId = "CT-K-1";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Invalid requireBaseRevision must reject command with VALIDATION/INVALID_BASE_REVISION and no commit.";
    task.meta.criticality = "Structural";
    const kernel = new KernelMinimalImpl(store);

    const result = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k1",
      requireBaseRevision: "rev/unknown"
    });

    expect(result).toEqual({
      status: "rejected",
      commandId: "cmd-k1",
      category: "VALIDATION",
      reasonCode: REASON_CODES.INVALID_BASE_REVISION
    });
  });

  it("[INV:CT-K-2][SURF:Kernel] CT-K-2: idempotent resubmission with same key returns same receipt", async ({ task }) => {
    task.meta.invariantId = "CT-K-2";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Replaying same actorId+idempotencyKey+payload returns the exact original committed receipt.";
    task.meta.criticality = "Critical";
    const kernel = new KernelMinimalImpl(store);

    const first = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k2"
    });
    const second = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k2-replayed"
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "committed",
      txId: "cmd-k2",
      txIndex: 1,
      cursorAfter: { metaSeq: 0, graphSeq: 1 },
      eventRefs: {
        meta: [],
        graph: [{ stream: "graph", seq: 1, eventId: "cmd-k2-g-1" }]
      }
    });
  });

  it("[INV:CT-K-3][SURF:Kernel] CT-K-3: idempotency key reuse with payload mismatch is rejected", async ({ task }) => {
    task.meta.invariantId = "CT-K-3";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Reusing idempotency key with different payload must reject with CONFLICT/IDEMPOTENCY_PAYLOAD_MISMATCH.";
    task.meta.criticality = "Critical";
    const kernel = new KernelMinimalImpl(store);

    const accepted = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k3-ok"
    });
    const rejected = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k3-conflict",
      payload: { op: "SET", value: 999 }
    });

    expect(accepted).toMatchObject({ status: "committed", txId: "cmd-k3-ok", txIndex: 1 });
    expect(rejected).toEqual({
      status: "rejected",
      category: "CONFLICT",
      reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH
    });
  });

  it("[INV:CT-K-4][SURF:Kernel] CT-K-4: commit invariants preserve appendTx + base revision preconditions", async ({ task }) => {
    task.meta.invariantId = "CT-K-4";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Append-layer precondition failures must be propagated as PRECONDITION/REVISION_MISMATCH.";
    task.meta.criticality = "Critical";
    const fakeStore = new RevisionMismatchStore();
    const kernel = new KernelMinimalImpl(fakeStore);

    const result = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k4",
      requireBaseRevision: "rev/current"
    });

    expect(fakeStore.resolveRevisionCalls).toEqual([["space-k", "rev/current"]]);
    expect(fakeStore.appendCalls).toHaveLength(1);
    expect(result).toEqual({
      status: "rejected",
      category: "PRECONDITION",
      reasonCode: REASON_CODES.REVISION_MISMATCH,
      commandId: "cmd-k4"
    });
  });

  it("[INV:CT-K-5][SURF:Kernel] CT-K-5 contradiction: malformed command is rejected", async ({ task }) => {
    task.meta.invariantId = "CT-K-5";
    task.meta.surface = "Kernel";
    task.meta.oracle = "Malformed command input must be rejected with VALIDATION/MALFORMED_COMMAND.";
    task.meta.criticality = "Regression";
    const kernel = new KernelMinimalImpl(store);

    const result = await kernel.execute({ ...baseCommand, commandId: "", idempotencyKey: "", payload: undefined as never });

    expect(result).toEqual({
      status: "rejected",
      commandId: "",
      category: "VALIDATION",
      reasonCode: REASON_CODES.MALFORMED_COMMAND
    });
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

  async readTxForPrincipal(
    graphSpaceId: string,
    txId: TxId
  ): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError> {
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

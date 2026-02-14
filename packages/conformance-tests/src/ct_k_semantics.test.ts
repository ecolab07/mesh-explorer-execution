import { describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { InMemoryLocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import {
  REASON_CODES,
  type Command,
  type CommandError,
  type Cursor,
  type EventEnvelope,
  type IdempotencyCtx,
  type ReadMode,
  type StreamName,
  type TransactionReceipt,
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

describe("CT-K-* Kernel command semantics", () => {
  it("CT-K-1: invalid baseRevision returns normalized error", async () => {
    const kernel = new KernelMinimalImpl(new InMemoryLocalEventStore());

    const result = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k1",
      requireBaseRevision: "rev/unknown"
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.category).toBe("VALIDATION");
      expect(result.reasonCode).toBe(REASON_CODES.INVALID_BASE_REVISION);
      expect(result.commandId).toBe("cmd-k1");
    }
  });

  it("CT-K-2: idempotent resubmission with same key returns same receipt", async () => {
    const kernel = new KernelMinimalImpl(new InMemoryLocalEventStore());

    const first = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k2"
    });
    const second = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k2-replayed"
    });

    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    if (first.status === "committed" && second.status === "committed") {
      expect(second).toEqual(first);
      expect(second.txId).toBe(first.txId);
      expect(second.eventRefs.graph).toHaveLength(1);
    }
  });

  it("CT-K-3: idempotency key reuse with payload mismatch is rejected", async () => {
    const kernel = new KernelMinimalImpl(new InMemoryLocalEventStore());

    const accepted = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k3-ok"
    });
    const rejected = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k3-conflict",
      payload: { op: "SET", value: 999 }
    });

    expect(accepted.status).toBe("committed");
    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.category).toBe("CONFLICT");
      expect(rejected.reasonCode).toBe(REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH);
    }
  });

  it("CT-K-4: commit invariants preserve appendTx + base revision preconditions", async () => {
    const fakeStore = new RevisionMismatchStore();
    const kernel = new KernelMinimalImpl(fakeStore);

    const result = await kernel.execute({
      ...baseCommand,
      commandId: "cmd-k4",
      requireBaseRevision: "rev/current"
    });

    expect(fakeStore.resolveRevisionCalls).toEqual([["space-k", "rev/current"]]);
    expect(fakeStore.appendCalls).toHaveLength(1);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.category).toBe("PRECONDITION");
      expect(result.reasonCode).toBe(REASON_CODES.REVISION_MISMATCH);
    }
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

  async readRange(_graphSpaceId: string, _stream: StreamName, _fromSeqExclusive: number, _limit: number, _mode: ReadMode): Promise<EventEnvelope[]> {
    return [];
  }

  async getCursorHead(_graphSpaceId: string): Promise<Cursor> {
    return { metaSeq: 0, graphSeq: 0 };
  }

  async resolveRevision(graphSpaceId: string, revisionToken: string): Promise<Cursor | null> {
    this.resolveRevisionCalls.push([graphSpaceId, revisionToken]);
    return { metaSeq: 0, graphSeq: 0 };
  }
}

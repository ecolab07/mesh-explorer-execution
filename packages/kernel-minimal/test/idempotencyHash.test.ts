import { describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import type { Command, IdempotencyCtx, TransactionReceipt } from "@mesh/shared";
import { KernelMinimalImpl } from "../src/KernelMinimalImpl.js";

function makeStore(captured: { value?: IdempotencyCtx }): LocalEventStore {
  return {
    async appendTx(_graphSpaceId, txBundle, idempotencyCtx): Promise<TransactionReceipt> {
      captured.value = idempotencyCtx;
      return {
        status: "committed",
        commandId: txBundle.txId,
        txId: txBundle.txId,
        txIndex: 1,
        cursorAfter: { metaSeq: 0, graphSeq: 1 },
        eventRefs: { meta: [], graph: [] }
      };
    },
    async readTx() {
      return null;
    },
    async readTxForPrincipal() {
      return { status: "rejected", category: "NOT_FOUND", reasonCode: "NOT_FOUND_OR_MASKED" };
    },
    async readRange() {
      return [];
    },
    async readTxIndex() {
      return [];
    },
    async getCursorHead() {
      return { metaSeq: 0, graphSeq: 0 };
    },
    async readPrincipalTxRange() {
      return { txs: [], cursor: 0 };
    },
    async getPrincipalCursorHead() {
      return 0;
    },
    async resolveRevision() {
      return null;
    },
    async compactUpToCursor() {
      return;
    }
  };
}

describe("KernelMinimal idempotency payload hash", () => {
  it("is invariant to payload key insertion order", async () => {
    const capturedA: { value?: IdempotencyCtx } = {};
    const capturedB: { value?: IdempotencyCtx } = {};
    const kernelA = new KernelMinimalImpl(makeStore(capturedA));
    const kernelB = new KernelMinimalImpl(makeStore(capturedB));

    const base: Omit<Command, "payload" | "commandId" | "idempotencyKey"> = {
      graphSpaceId: "space-a",
      actorId: "actor-a"
    };

    await kernelA.execute({
      ...base,
      commandId: "cmd-a",
      idempotencyKey: "key-a",
      payload: { a: 1, b: { x: 2, y: 3 } }
    });
    await kernelB.execute({
      ...base,
      commandId: "cmd-b",
      idempotencyKey: "key-b",
      payload: { b: { y: 3, x: 2 }, a: 1 }
    });

    expect(capturedA.value?.payloadHash).toBeDefined();
    expect(capturedA.value?.payloadHash).toBe(capturedB.value?.payloadHash);
  });
});

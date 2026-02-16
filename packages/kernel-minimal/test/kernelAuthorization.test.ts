import { describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import type { Command, CommandError, CommandOutcome, Cursor, IdempotencyCtx, TransactionReceipt } from "@mesh/shared";
import { REASON_CODES } from "@mesh/shared";
import { KernelMinimalImpl } from "../src/KernelMinimalImpl.js";

type AuthorizationDecision = "allow" | "deny" | "mask";

type StoreWithInternalAuthorizer = LocalEventStore & {
  __meshInternalAuthorizer?: {
    authorize(command: Command): { decision: AuthorizationDecision };
  };
};

interface StoreState {
  writes: number;
  appendCalls: number;
  idempotency: IdempotencyCtx[];
}

function makeStore(params?: { appendOutcome?: CommandOutcome; authorizerDecision?: AuthorizationDecision }): {
  store: StoreWithInternalAuthorizer;
  state: StoreState;
} {
  const state: StoreState = {
    writes: 0,
    appendCalls: 0,
    idempotency: []
  };

  const appendOutcome =
    params?.appendOutcome ??
    ({
      status: "committed",
      commandId: "cmd-1",
      txId: "cmd-1",
      txIndex: 1,
      cursorAfter: { metaSeq: 0, graphSeq: 1 },
      eventRefs: { meta: [], graph: [] }
    } satisfies TransactionReceipt);

  const store: StoreWithInternalAuthorizer = {
    async appendTx(_graphSpaceId, _txBundle, idempotencyCtx): Promise<TransactionReceipt | CommandError> {
      state.appendCalls += 1;
      state.idempotency.push(idempotencyCtx);
      if (appendOutcome.status === "committed") {
        state.writes += 1;
      }
      return appendOutcome;
    },
    async readTx() {
      return null;
    },
    async readTxForPrincipal() {
      return { status: "rejected", category: "NOT_FOUND", reasonCode: REASON_CODES.NOT_FOUND_OR_MASKED };
    },
    async readRange() {
      return [];
    },
    async readTxIndex() {
      return [];
    },
    async getCursorHead(): Promise<Cursor> {
      return { metaSeq: 0, graphSeq: 0 };
    },
    async readPrincipalTxRange() {
      return { txs: [], cursor: 0 };
    },
    async getPrincipalCursorHead() {
      return 0;
    },
    async resolveRevision() {
      return { metaSeq: 0, graphSeq: 0 };
    },
    async compactUpToCursor() {
      return;
    }
  };

  if (params?.authorizerDecision) {
    store.__meshInternalAuthorizer = {
      authorize() {
        return { decision: params.authorizerDecision ?? "allow" };
      }
    };
  }

  return { store, state };
}

const baseCommand: Command = {
  graphSpaceId: "space-a",
  commandId: "cmd-1",
  actorId: "actor-a",
  idempotencyKey: "idem-a",
  payload: { op: "set", value: 1 }
};

function normalizeUserSafeError(outcome: CommandOutcome) {
  if (outcome.status === "committed") {
    throw new Error("Expected rejected outcome");
  }

  return {
    status: outcome.status,
    commandId: outcome.commandId,
    category: outcome.category,
    reasonCode: outcome.reasonCode
  };
}

describe("KernelMinimal authorization", () => {
  it("deny returns PERMISSION and causes no write", async () => {
    const { store, state } = makeStore({ authorizerDecision: "deny" });
    const kernel = new KernelMinimalImpl(store);

    const outcome = await kernel.execute(baseCommand);

    expect(outcome).toEqual({
      status: "rejected",
      commandId: baseCommand.commandId,
      category: "PERMISSION",
      reasonCode: "CMD.PERMISSION.DENIED"
    });
    expect(state.writes).toBe(0);
    expect(state.appendCalls).toBe(0);
    expect(state.idempotency).toHaveLength(0);
  });

  it("mask is user-safe indistinguishable from generic NOT_FOUND", async () => {
    const masked = makeStore({ authorizerDecision: "mask" });
    const kernelMasked = new KernelMinimalImpl(masked.store);

    const notFound = makeStore({
      authorizerDecision: "allow",
      appendOutcome: {
        status: "rejected",
        commandId: baseCommand.commandId,
        category: "NOT_FOUND",
        reasonCode: REASON_CODES.NOT_FOUND_GENERIC
      }
    });
    const kernelNotFound = new KernelMinimalImpl(notFound.store);

    const maskedOutcome = await kernelMasked.execute(baseCommand);
    const notFoundOutcome = await kernelNotFound.execute(baseCommand);

    expect(normalizeUserSafeError(maskedOutcome)).toEqual(normalizeUserSafeError(notFoundOutcome));
    expect(masked.state.writes).toBe(0);
    expect(masked.state.appendCalls).toBe(0);
    expect(notFound.state.writes).toBe(0);
  });

  it("retry under mask is stable and causes no write", async () => {
    const { store, state } = makeStore({ authorizerDecision: "mask" });
    const kernel = new KernelMinimalImpl(store);

    const first = await kernel.execute(baseCommand);
    const second = await kernel.execute(baseCommand);

    expect(normalizeUserSafeError(first)).toEqual(normalizeUserSafeError(second));
    expect(state.writes).toBe(0);
    expect(state.appendCalls).toBe(0);
    expect(state.idempotency).toHaveLength(0);
  });
});

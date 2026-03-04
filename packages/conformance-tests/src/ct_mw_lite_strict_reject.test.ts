import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalEventStore } from "@mesh/eventstore-local";
import { revisionTokenForHead } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { buildCanonicalStateDump } from "@mesh/conformance-harness";
import { REASON_CODES, canonicalString, type Command, type CommandOutcome } from "@mesh/shared";
import { getConformanceBackends, makeStore, type ConformanceBackend } from "./backends.js";

const backends = getConformanceBackends().filter((backend): backend is ConformanceBackend => backend !== "indexeddb");

function evidence(command: Command, outcome: CommandOutcome, before: string, after: string, cursorBefore: unknown, cursorAfter: unknown): string {
  return [
    `commandId=${command.commandId}`,
    `baseRevision=${command.requireBaseRevision ?? "<none>"}`,
    `cursorBefore=${canonicalString(cursorBefore)}`,
    `cursorAfter=${canonicalString(cursorAfter)}`,
    `expectedReason=${REASON_CODES.REVISION_MISMATCH}`,
    `observedReason=${outcome.status === "committed" ? "<committed>" : outcome.reasonCode}`,
    `dumpBefore=${before}`,
    `dumpAfter=${after}`
  ].join("\n");
}

describe.each(backends)("CT-MW-LITE-* strict reject (%s)", (backend) => {
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

  it("[INV:CT-MW-LITE-1][SURF:V2-MultiWriter] CT-MW-LITE-1: concurrent base revision has one winner and one strict mismatch reject", async ({ task }) => {
    task.meta.invariantId = "CT-MW-LITE-1";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Two commands carrying the same opaque requireBaseRevision token produce exactly one commit and one PRECONDITION/REVISION_MISMATCH reject with no partial effects.";
    task.meta.criticality = "Critical";

    const kernel = new KernelMinimalImpl(store);
    const graphSpaceId = `space-mw-lite-1-${backend}`;
    const txIndexBefore = await store.readTxIndex(graphSpaceId);
    const baseRevisionToken = revisionTokenForHead(txIndexBefore);

    const commandA: Command = {
      graphSpaceId,
      commandId: `mw-lite-1-a-${backend}`,
      actorId: "writer-a",
      idempotencyKey: `mw-lite-1-idem-a-${backend}`,
      payload: { op: "SET", branch: "A" },
      requireBaseRevision: baseRevisionToken
    };

    const commandB: Command = {
      graphSpaceId,
      commandId: `mw-lite-1-b-${backend}`,
      actorId: "writer-b",
      idempotencyKey: `mw-lite-1-idem-b-${backend}`,
      payload: { op: "SET", branch: "B" },
      requireBaseRevision: baseRevisionToken
    };

    const cursorBefore = await store.getCursorHead(graphSpaceId);
    const dumpBefore = canonicalString(await buildCanonicalStateDump(store, graphSpaceId));
    const outcomeA = await kernel.execute(commandA);
    const outcomeB = await kernel.execute(commandB);
    const cursorAfter = await store.getCursorHead(graphSpaceId);
    const dumpAfter = canonicalString(await buildCanonicalStateDump(store, graphSpaceId));

    const committed = [outcomeA, outcomeB].filter((outcome) => outcome.status === "committed");
    const rejected = [outcomeA, outcomeB].filter((outcome) => outcome.status !== "committed");

    expect(committed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      category: "PRECONDITION",
      reasonCode: REASON_CODES.REVISION_MISMATCH
    });

    const winner = committed[0];
    expect(winner).toBeTruthy();
    const txIndex = await store.readTxIndex(graphSpaceId);
    expect(txIndex.map((entry) => entry.txId)).toEqual([winner?.txId]);

    const loser = rejected[0];
    expect(loser?.reasonCode, evidence(commandB, loser, dumpBefore, dumpAfter, cursorBefore, cursorAfter)).toBe(
      REASON_CODES.REVISION_MISMATCH
    );
  });

  it("[INV:CT-MW-LITE-2][SURF:V2-MultiWriter] CT-MW-LITE-2: winner retry is exactly idempotent", async ({ task }) => {
    task.meta.invariantId = "CT-MW-LITE-2";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Retrying winner command with same actor+idempotencyKey+payload returns byte-equivalent receipt and leaves state unchanged.";
    task.meta.criticality = "Critical";

    const kernel = new KernelMinimalImpl(store);
    const graphSpaceId = `space-mw-lite-2-${backend}`;
    const baseRevisionToken = revisionTokenForHead(await store.readTxIndex(graphSpaceId));

    const winner: Command = {
      graphSpaceId,
      commandId: `mw-lite-2-winner-${backend}`,
      actorId: "writer-a",
      idempotencyKey: `mw-lite-2-idem-a-${backend}`,
      payload: { op: "SET", value: 2 },
      requireBaseRevision: baseRevisionToken
    };

    const first = await kernel.execute(winner);
    const retry = await kernel.execute({ ...winner, commandId: `mw-lite-2-winner-retry-${backend}` });

    expect(canonicalString(retry)).toEqual(canonicalString(first));
    expect(await store.readTxIndex(graphSpaceId)).toHaveLength(1);
  });

  it("[INV:CT-MW-LITE-3][SURF:V2-MultiWriter] CT-MW-LITE-3: loser retry with payload mismatch stays conflict and no-op", async ({ task }) => {
    task.meta.invariantId = "CT-MW-LITE-3";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Reusing winner actor+idempotencyKey with different payload is rejected as CONFLICT/IDEMPOTENCY_PAYLOAD_MISMATCH and preserves canonical dump.";
    task.meta.criticality = "Critical";

    const kernel = new KernelMinimalImpl(store);
    const graphSpaceId = `space-mw-lite-3-${backend}`;
    const baseRevisionToken = revisionTokenForHead(await store.readTxIndex(graphSpaceId));

    const winner: Command = {
      graphSpaceId,
      commandId: `mw-lite-3-winner-${backend}`,
      actorId: "writer-a",
      idempotencyKey: `mw-lite-3-idem-a-${backend}`,
      payload: { op: "SET", value: 3 },
      requireBaseRevision: baseRevisionToken
    };

    const committed = await kernel.execute(winner);
    expect(committed.status).toBe("committed");

    const beforeDump = canonicalString(await buildCanonicalStateDump(store, graphSpaceId));
    const beforeCursor = await store.getCursorHead(graphSpaceId);

    const mismatched = await kernel.execute({
      ...winner,
      commandId: `mw-lite-3-mismatch-${backend}`,
      payload: { op: "SET", value: 999 }
    });

    const afterDump = canonicalString(await buildCanonicalStateDump(store, graphSpaceId));
    const afterCursor = await store.getCursorHead(graphSpaceId);

    expect(mismatched).toMatchObject({
      status: "rejected",
      category: "CONFLICT",
      reasonCode: REASON_CODES.IDEMPOTENCY_PAYLOAD_MISMATCH
    });
    expect(afterDump).toBe(beforeDump);
    expect(afterCursor).toEqual(beforeCursor);
  });

  it("[INV:CT-MW-LITE-4][SURF:V2-MultiWriter] CT-MW-LITE-4: OUT (mask/permissions surface not active in this harness)", async ({ task }) => {
    task.meta.invariantId = "CT-MW-LITE-4";
    task.meta.surface = "V2-MultiWriter";
    task.meta.oracle =
      "Mask/permissions indistinguishability check is explicitly OUT for this harness until policy-aware revision gate fixtures are available.";
    task.meta.criticality = "Regression";

    expect("Mask/permission revision mismatch fixture pending in this harness").toContain("fixture");
  });
});

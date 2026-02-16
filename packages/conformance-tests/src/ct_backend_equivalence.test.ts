import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePersistentEventStore, type LocalEventStore } from "@mesh/eventstore-local";
import { buildCanonicalStateDump } from "@mesh/conformance-harness";
import { canonicalString } from "@mesh/shared";
import { PrincipalProjectionEngine } from "@mesh/projection-minimal";

type StoreWithCleanup = {
  store: LocalEventStore;
  cleanup: () => Promise<void>;
};

function normalizeCanonicalDump(dump: Awaited<ReturnType<typeof buildCanonicalStateDump>>) {
  return {
    version: dump.version,
    graphSpaceId: dump.graphSpaceId,
    cursorHead: dump.cursorHead,
    streams: {
      meta: dump.streams.meta.map((event) => ({ stream: event.stream, seq: event.seq, payload: event.payload })),
      graph: dump.streams.graph.map((event) => ({ stream: event.stream, seq: event.seq, payload: event.payload }))
    },
    txIndex: dump.txIndex.map((entry) => ({
      txIndex: entry.txIndex,
      meta: entry.meta,
      graph: entry.graph
    }))
  };
}

function normalizeReceipt(receipt: Awaited<ReturnType<LocalEventStore["appendTx"]>>) {
  if (receipt.status !== "committed") {
    return receipt;
  }

  return {
    status: receipt.status,
    txIndex: receipt.txIndex,
    cursorAfter: receipt.cursorAfter,
    eventRefs: {
      metaCount: receipt.eventRefs.meta.length,
      graphCount: receipt.eventRefs.graph.length,
      metaSeqs: receipt.eventRefs.meta.map((ref) => ref.seq),
      graphSeqs: receipt.eventRefs.graph.map((ref) => ref.seq)
    }
  };
}

async function createFileBackedStore(): Promise<StoreWithCleanup> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-xbackend-file-"));
  const filePath = path.join(dir, "eventstore.json");
  const store = await makePersistentEventStore(filePath);
  return {
    store,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

async function createIndexedDbStore(graphSpaceId: string): Promise<StoreWithCleanup> {
  const dbUri = `indexeddb://mesh-xbackend-${graphSpaceId}`;
  const primingStore = (await makePersistentEventStore(dbUri)) as LocalEventStore & { deleteDatabase?: () => Promise<void> };
  await primingStore.deleteDatabase?.();

  const store = (await makePersistentEventStore(dbUri)) as LocalEventStore & { deleteDatabase?: () => Promise<void> };
  return {
    store,
    cleanup: async () => {
      await store.deleteDatabase?.();
    }
  };
}

describe("cross-backend equivalence", () => {
  const resources: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (resources.length > 0) {
      const cleanup = resources.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  it("matches canonical event-store dump + projection snapshot between file-backed and indexeddb", async () => {
    const graphSpaceId = "space-cross-backend-equivalence";
    const sequence = [
      { txId: "tx-1", payload: { type: "CMD.NOOP", idx: 1, tags: ["a"] } },
      { txId: "tx-2", payload: { type: "CMD.NOOP", idx: 2, tags: ["a", "b"] } },
      { txId: "tx-3", payload: { type: "CMD.NOOP", idx: 3, tags: ["b"] } },
      { txId: "tx-4", payload: { type: "CMD.NOOP", idx: 4, nested: { ok: true } } }
    ];

    const file = await createFileBackedStore();
    const indexedDb = await createIndexedDbStore(graphSpaceId);
    resources.push(file.cleanup, indexedDb.cleanup);

    const fileReceipts: unknown[] = [];
    const indexedDbReceipts: unknown[] = [];
    for (const entry of sequence) {
      const idem = {
        actorId: "actor-cross-backend",
        idempotencyKey: `idem-${entry.txId}`,
        payloadHash: `hash-${entry.txId}`
      };
      fileReceipts.push(normalizeReceipt(await file.store.appendTx(graphSpaceId, { txId: entry.txId, metaEvents: [{ marker: entry.txId }], graphEvents: [entry.payload] }, idem)));
      indexedDbReceipts.push(
        normalizeReceipt(await indexedDb.store.appendTx(graphSpaceId, { txId: entry.txId, metaEvents: [{ marker: entry.txId }], graphEvents: [entry.payload] }, idem))
      );
    }

    const fileDump = normalizeCanonicalDump(await buildCanonicalStateDump(file.store, graphSpaceId));
    const indexedDbDump = normalizeCanonicalDump(await buildCanonicalStateDump(indexedDb.store, graphSpaceId));
    expect(canonicalString(indexedDbReceipts)).toEqual(canonicalString(fileReceipts));
    expect(canonicalString(indexedDbDump)).toEqual(canonicalString(fileDump));

    const principal = { principalId: "any-user" };
    const fileProjection = await new PrincipalProjectionEngine(file.store, graphSpaceId).rebuild(principal);
    const indexedDbProjection = await new PrincipalProjectionEngine(indexedDb.store, graphSpaceId).rebuild(principal);
    expect(canonicalString(indexedDbProjection)).toEqual(canonicalString(fileProjection));
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore } from "../src/index.js";

describe("file-backed tx atomicity", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps appendTx commit-or-nothing when persistState fails after staging", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mesh-eventstore-atomic-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "store.json");

    const store = new FileBackedLocalEventStore(filePath);
    const graphSpaceId = "space-atomic";

    const originalPersist = (store as unknown as { persistState: () => Promise<void> }).persistState.bind(store);
    let failOnce = true;
    (store as unknown as { persistState: () => Promise<void> }).persistState = async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error("simulated persist failure");
      }
      await originalPersist();
    };

    await expect(
      store.appendTx(
        graphSpaceId,
        { txId: "tx-atomic-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }] },
        { actorId: "alice", idempotencyKey: "idem-atomic-1", payloadHash: "hash-atomic-1" }
      )
    ).rejects.toThrow("simulated persist failure");

    expect(await store.readTxIndex(graphSpaceId)).toEqual([]);
    expect(await store.readRange(graphSpaceId, "meta", 0, 10, "TX_CLOSED")).toEqual([]);
    expect(await store.readRange(graphSpaceId, "graph", 0, 10, "TX_CLOSED")).toEqual([]);

    const retry = await store.appendTx(
      graphSpaceId,
      { txId: "tx-atomic-1", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }] },
      { actorId: "alice", idempotencyKey: "idem-atomic-1", payloadHash: "hash-atomic-1" }
    );
    expect(retry).toMatchObject({ status: "committed", txId: "tx-atomic-1", txIndex: 1 });
  });
});

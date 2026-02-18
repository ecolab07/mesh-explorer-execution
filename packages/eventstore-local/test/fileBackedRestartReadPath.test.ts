import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore } from "../src/index.js";

describe("file-backed store cold-start read path", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("loads persisted tx history for readPrincipalTxRange after process-style restart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mesh-eventstore-restart-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "store.json");
    const graphSpaceId = "space-restart";
    const principal = { principalId: "local-dev" };

    const first = new FileBackedLocalEventStore(filePath);
    await first.appendTx(
      graphSpaceId,
      {
        txId: "tx-1",
        metaEvents: [{ type: "meta.created" }],
        graphEvents: [{ type: "graph.node.created", node: { id: "n-1", label: "N1" } }]
      },
      {
        actorId: principal.principalId,
        idempotencyKey: "idem-1",
        payloadHash: "hash-1"
      }
    );
    await first.close();

    const restarted = new FileBackedLocalEventStore(filePath);
    const range = await restarted.readPrincipalTxRange(graphSpaceId, 0, 10, principal);

    expect(range.txs).toHaveLength(1);
    expect(range.txs[0]?.txId).toBe("tx-1");
    expect(range.cursor).toBe(1);
  });
});

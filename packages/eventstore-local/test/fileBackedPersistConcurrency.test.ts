import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileBackedLocalEventStore } from "../src/index.js";

describe("file-backed persist serialization", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles concurrent appendTx without temp-file rename races", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mesh-eventstore-concurrency-"));
    tempDirs.push(dir);
    const store = new FileBackedLocalEventStore(path.join(dir, "store.json"));
    const graphSpaceId = "space-concurrency";

    await Promise.all(
      Array.from({ length: 100 }).map((_, idx) =>
        store.appendTx(
          graphSpaceId,
          {
            txId: `tx-${idx + 1}`,
            metaEvents: [{ type: "meta.created", idx }],
            graphEvents: [{ type: "graph.node.created", node: { id: `n-${idx + 1}`, label: `N-${idx + 1}` } }]
          },
          {
            actorId: "local-dev",
            idempotencyKey: `idem-${idx + 1}`,
            payloadHash: `hash-${idx + 1}`
          }
        )
      )
    );

    const head = await store.getCursorHead(graphSpaceId);
    expect(head.graphSeq).toBe(100);
  });
});

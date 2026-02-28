import { describe, expect, it } from "vitest";

import { resolveBootstrapFromCursor, resolveBootstrapReplayPlan } from "../src/bootstrapCursor.js";
import { createGraphStore, type GraphEvent } from "../src/graphStore.js";
import { buildSyncPollUrl } from "../src/syncPollRequest.js";

describe("sync poll request bootstrap", () => {
  it("builds initial sync:poll with {0,0} when store is empty and persisted cursor is non-zero", () => {
    const fromCursor = resolveBootstrapFromCursor({ metaSeq: 0, graphSeq: 39 }, { nodesCount: 0, linksCount: 0 });
    const url = new URL(buildSyncPollUrl("http://127.0.0.1:8090", "mesh-explorer-graph-v1", fromCursor, { graph: 128, meta: 32 }));

    expect(JSON.parse(url.searchParams.get("cursor") ?? "{}")).toEqual({ metaSeq: 0, graphSeq: 0 });
  });

  it("builds initial sync:poll with persisted cursor when store is non-empty", () => {
    const fromCursor = resolveBootstrapFromCursor({ metaSeq: 0, graphSeq: 39 }, { nodesCount: 1, linksCount: 0 });
    const url = new URL(buildSyncPollUrl("http://127.0.0.1:8090", "mesh-explorer-graph-v1", fromCursor, { graph: 128, meta: 32 }));

    expect(JSON.parse(url.searchParams.get("cursor") ?? "{}")).toEqual({ metaSeq: 0, graphSeq: 39 });
  });

  it("uses pollCursorParam=start-1 for projectionEmpty bootstrap replay", () => {
    const plan = resolveBootstrapReplayPlan({
      projectionEmpty: true,
      floorCursor: { metaSeq: 0, graphSeq: 6 },
      snapshotCursor: { metaSeq: 0, graphSeq: 5 },
      targetCursor: { metaSeq: 0, graphSeq: 8 }
    });
    const url = new URL(buildSyncPollUrl("http://127.0.0.1:8090", "mesh-explorer-graph-v1", plan.pollCursorParam, { graph: 128, meta: 32 }));

    expect(plan.pollStartCursor).toEqual({ metaSeq: 0, graphSeq: 6 });
    expect(JSON.parse(url.searchParams.get("cursor") ?? "{}")).toEqual({ metaSeq: 0, graphSeq: 5 });

    const store = createGraphStore();
    const snapshotNodes = Array.from({ length: 5 }, (_, idx) => ({ id: `n${idx + 1}`, label: `Node ${idx + 1}` }));
    store.applyGraphEvents(snapshotNodes.map((node) => ({ type: "graph.node.created", node } as GraphEvent)));

    const deltaEvents = [6, 7, 8].map((seq) => ({
      type: "graph.node.created",
      node: { id: `n${seq}`, label: `Node ${seq}` }
    })) as GraphEvent[];
    store.applyGraphEvents(deltaEvents);

    expect(store.getState().nodesById.size).toBe(8);
  });

});

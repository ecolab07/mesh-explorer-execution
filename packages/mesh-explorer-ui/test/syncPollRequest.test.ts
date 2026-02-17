import { describe, expect, it } from "vitest";

import { resolveBootstrapFromCursor } from "../src/bootstrapCursor.js";
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
});

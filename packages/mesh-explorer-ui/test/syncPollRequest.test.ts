import { describe, expect, it } from "vitest";

import { resolveBootstrapFromCursor } from "../src/bootstrapCursor.js";
import { buildSyncPollUrl } from "../src/syncPollRequest.js";

describe("sync poll request bootstrap", () => {
  it("builds initial sync:poll from snapshot cursor when no state digest is available", () => {
    const fromCursor = resolveBootstrapFromCursor({ metaSeq: 0, graphSeq: 39 }, { cursor: { metaSeq: 0, graphSeq: 0 } });
    const url = new URL(buildSyncPollUrl("http://127.0.0.1:8090", "mesh-explorer-graph-v1", fromCursor, { graph: 128, meta: 32 }));

    expect(JSON.parse(url.searchParams.get("cursor") ?? "{}")).toEqual({ metaSeq: 0, graphSeq: 0 });
  });

  it("builds initial sync:poll with snapshot cursor when snapshot is ahead", () => {
    const fromCursor = resolveBootstrapFromCursor({ metaSeq: 0, graphSeq: 39 }, { cursor: { metaSeq: 2, graphSeq: 41 } });
    const url = new URL(buildSyncPollUrl("http://127.0.0.1:8090", "mesh-explorer-graph-v1", fromCursor, { graph: 128, meta: 32 }));

    expect(JSON.parse(url.searchParams.get("cursor") ?? "{}")).toEqual({ metaSeq: 2, graphSeq: 41 });
  });
});

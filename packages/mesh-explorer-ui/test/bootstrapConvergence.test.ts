import { describe, expect, it } from "vitest";

import { createGraphStore, type Cursor, type GraphEvent } from "../src/graphStore.js";
import { hydrateStoreFromProjection, makeBootstrapCacheRecord, type BootstrapProjection } from "../src/bootstrapCache.js";
import { nextMonotonicCursor, resolveBootstrapCursorDecision, shouldPersistBootstrapCursor } from "../src/bootstrapCursor.js";

const AUTHORITY_EVENTS: GraphEvent[] = [
  { type: "graph.node.created", node: { id: "n1", label: "A" } },
  { type: "graph.node.created", node: { id: "n2", label: "B" } },
  { type: "graph.link.created", link: { id: "l1", source: "n1", target: "n2", type: "depends" } }
];

function replayFrom(cursor: Cursor, store = createGraphStore()): { cursor: Cursor; state: ReturnType<typeof normalizeState> } {
  const start = Math.max(0, cursor.graphSeq);
  const events = AUTHORITY_EVENTS.slice(start);
  if (events.length > 0) store.applyGraphEvents(events);
  store.setCursor({ metaSeq: 0, graphSeq: AUTHORITY_EVENTS.length });
  return { cursor: store.getState().cursor, state: normalizeState(store) };
}

function normalizeState(store: ReturnType<typeof createGraphStore>) {
  const state = store.getState();
  return {
    nodes: Array.from(state.nodesById.values()).sort((a, b) => a.id.localeCompare(b.id)),
    links: Array.from(state.linksById.values()).sort((a, b) => a.id.localeCompare(b.id))
  };
}

describe("bootstrap convergence guards", () => {
  it("multi-replica restarts with asymmetric local state converge to same cursor+state", () => {
    const snapshotProjection: BootstrapProjection = {
      version: 1,
      nodes: [
        { id: "n1", label: "A" },
        { id: "n2", label: "B" }
      ],
      links: []
    };
    const snapshotCursor = { metaSeq: 0, graphSeq: 2 };

    const replicaAStore = createGraphStore();
    const replicaACache = makeBootstrapCacheRecord(snapshotCursor, snapshotProjection);
    const decisionA = resolveBootstrapCursorDecision({
      savedCursor: snapshotCursor,
      snapshot: { cursor: snapshotCursor },
      bootstrapCache: replicaACache
    });
    hydrateStoreFromProjection(replicaAStore, replicaACache.projection);
    replicaAStore.setCursor(decisionA.bootstrapFrom);
    const finalA = replayFrom(decisionA.bootstrapFrom, replicaAStore);

    const replicaBStore = createGraphStore();
    const staleCache = makeBootstrapCacheRecord({ metaSeq: 0, graphSeq: 1 }, { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] });
    staleCache.schemaVersion += 1;
    const decisionB = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 0, graphSeq: 1 },
      snapshot: { cursor: snapshotCursor },
      bootstrapCache: staleCache
    });
    // invalid cache path falls back to snapshot-derived bootstrap.
    hydrateStoreFromProjection(replicaBStore, snapshotProjection);
    replicaBStore.setCursor(decisionB.bootstrapFrom);
    const finalB = replayFrom(decisionB.bootstrapFrom, replicaBStore);

    expect(finalA.cursor).toEqual(finalB.cursor);
    expect(finalA.state).toEqual(finalB.state);
  });

  it("anchors replay start cursor to accepted snapshot cursor", () => {
    const decision = resolveBootstrapCursorDecision({
      savedCursor: { metaSeq: 0, graphSeq: 8 },
      snapshot: { cursor: { metaSeq: 0, graphSeq: 2 } },
      bootstrapCache: makeBootstrapCacheRecord(
        { metaSeq: 0, graphSeq: 2 },
        { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
      )
    });

    expect(decision.bootstrapFrom).toEqual({ metaSeq: 0, graphSeq: 2 });
  });

  it("does not finalize bootstrap cache state before replay completion", () => {
    const fromCursor = { metaSeq: 0, graphSeq: 2 };
    expect(shouldPersistBootstrapCursor(fromCursor, fromCursor, fromCursor)).toBe(false);
    expect(shouldPersistBootstrapCursor(fromCursor, { metaSeq: 0, graphSeq: 3 }, { metaSeq: 0, graphSeq: 3 })).toBe(true);
  });

  it("keeps applied cursor monotonic across restart cycles", () => {
    let durable = { metaSeq: 0, graphSeq: 3 };

    const restart1Candidate = { metaSeq: 0, graphSeq: 2 };
    durable = nextMonotonicCursor(durable, restart1Candidate);
    expect(durable).toEqual({ metaSeq: 0, graphSeq: 3 });

    const restart2Candidate = { metaSeq: 0, graphSeq: 4 };
    durable = nextMonotonicCursor(durable, restart2Candidate);
    expect(durable).toEqual({ metaSeq: 0, graphSeq: 4 });
  });
});

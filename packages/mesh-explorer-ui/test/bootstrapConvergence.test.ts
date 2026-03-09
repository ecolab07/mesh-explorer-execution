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

function visibilitySummary(store: ReturnType<typeof createGraphStore>) {
  const normalized = normalizeState(store);
  return {
    cursor: store.getState().cursor,
    nodeIds: normalized.nodes.map((node) => node.id),
    linkIds: normalized.links.map((link) => link.id)
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
    const convergedCursor = { metaSeq: 0, graphSeq: 3 };

    expect(shouldPersistBootstrapCursor(fromCursor, fromCursor, fromCursor, true)).toBe(false);
    expect(shouldPersistBootstrapCursor(fromCursor, convergedCursor, convergedCursor, false)).toBe(false);
    expect(shouldPersistBootstrapCursor(fromCursor, convergedCursor, convergedCursor, true)).toBe(true);
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

  it("refresh mismatch path replays canonical events into visible projection", () => {
    const staleSnapshotCursor = { metaSeq: 0, graphSeq: 0 };
    const savedCursor = { metaSeq: 0, graphSeq: 2 };
    const decision = resolveBootstrapCursorDecision({
      savedCursor,
      snapshot: { cursor: staleSnapshotCursor },
      bootstrapCache: makeBootstrapCacheRecord(savedCursor, { version: 1, nodes: [], links: [] })
    });
    expect(decision.reason).toBe("snapshot-only-cursor-mismatch");

    const store = createGraphStore();
    store.setCursor(decision.bootstrapFrom);
    const replay = replayFrom(decision.bootstrapFrom, store);

    expect(replay.cursor).toEqual({ metaSeq: 0, graphSeq: 3 });
    expect(replay.state.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(replay.state.links.map((link) => link.id)).toEqual(["l1"]);
  });

  it("deferred durable write does not block visible replay convergence", () => {
    const store = createGraphStore();
    store.resetProjection();
    store.setCursor({ metaSeq: 0, graphSeq: 0 });

    const replay = replayFrom({ metaSeq: 0, graphSeq: 0 }, store);
    const projectionBeforePersist = visibilitySummary(store);

    // Deferred write equivalent: visibility is already derived from replayed runtime state.
    const commitEligible = shouldPersistBootstrapCursor({ metaSeq: 0, graphSeq: 0 }, replay.cursor, store.getState().cursor, true);
    expect(commitEligible).toBe(true);
    expect(projectionBeforePersist.nodeIds).toEqual(["n1", "n2"]);
    expect(projectionBeforePersist.linkIds).toEqual(["l1"]);
  });

  it("stale snapshot materialization cannot overwrite post-replay visibility", () => {
    const store = createGraphStore();
    store.applyGraphEvents([{ type: "graph.node.created", node: { id: "stale", label: "stale" } }]);
    store.resetProjection();
    store.setCursor({ metaSeq: 0, graphSeq: 0 });

    replayFrom({ metaSeq: 0, graphSeq: 0 }, store);
    const afterReplay = visibilitySummary(store);

    // Stale path would be an empty snapshot, but replay-converged state remains authoritative.
    expect(afterReplay.nodeIds).toEqual(["n1", "n2"]);
    expect(afterReplay.linkIds).toEqual(["l1"]);
  });

  it("restart determinism: refreshed replay equals non-refresh canonical state", () => {
    const direct = createGraphStore();
    replayFrom({ metaSeq: 0, graphSeq: 0 }, direct);

    const refresh = createGraphStore();
    refresh.resetProjection();
    refresh.setCursor({ metaSeq: 0, graphSeq: 0 });
    replayFrom({ metaSeq: 0, graphSeq: 0 }, refresh);

    expect(visibilitySummary(refresh)).toEqual(visibilitySummary(direct));
  });
});

import { describe, expect, it } from "vitest";
import type { GraphEvent } from "../src/graphStore.js";
import { applyGuardedSyncBatch, type SyncIngestionState } from "../src/syncIngestion.js";

function nodeCreated(id: string): GraphEvent {
  return { type: "graph.node.created", node: { id, label: id } };
}

describe("sync ingestion dedup across transports", () => {
  it("duplicate delivered by subscribe then poll applies once", () => {
    const applied: GraphEvent[] = [];
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };

    const sse = applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "sse",
      candidateCursor: { metaSeq: 0, graphSeq: 1 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: (events) => applied.push(...events),
      log: () => undefined
    });

    const poll = applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "poll",
      candidateCursor: { metaSeq: 0, graphSeq: 2 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: (events) => applied.push(...events),
      log: () => undefined
    });

    expect(sse.appliedCount).toBe(1);
    expect(poll.appliedCount).toBe(0);
    expect(poll.duplicateCount).toBe(1);
    expect(applied).toHaveLength(1);
    expect(state.cursor.graphSeq).toBe(2);
  });

  it("overlapping poll/subscribe batches converge to deterministic state", () => {
    const run = (order: Array<"poll" | "sse">): string[] => {
      const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
      const applied: string[] = [];
      for (const source of order) {
        const events = source === "poll"
          ? [
              { eventId: "e-1", event: nodeCreated("n1") },
              { eventId: "e-2", event: nodeCreated("n2") }
            ]
          : [
              { eventId: "e-1", event: nodeCreated("n1") },
              { eventId: "e-2", event: nodeCreated("n2") },
              { eventId: "e-3", event: nodeCreated("n3") }
            ];
        const candidateCursor = source === "poll" ? { metaSeq: 0, graphSeq: 2 } : { metaSeq: 0, graphSeq: 3 };
        applyGuardedSyncBatch({
          graphSpaceId: "space-a",
          state,
          source,
          candidateCursor,
          events,
          applyGraphEvents: (batch) => {
            for (const event of batch) {
              if (event.type === "graph.node.created") applied.push(event.node.id);
            }
          },
          log: () => undefined
        });
      }
      return applied.sort();
    };

    expect(run(["poll", "sse"])).toEqual(run(["sse", "poll"]));
  });

  it("replay after already applied events produces no ghost update and cursor monotone", () => {
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
    const applied: GraphEvent[] = [];

    applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "poll",
      candidateCursor: { metaSeq: 0, graphSeq: 2 },
      events: [
        { eventId: "e-1", event: nodeCreated("n1") },
        { eventId: "e-2", event: nodeCreated("n2") }
      ],
      applyGraphEvents: (events) => applied.push(...events),
      log: () => undefined
    });

    const replay = applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "replay",
      candidateCursor: { metaSeq: 0, graphSeq: 3 },
      events: [
        { eventId: "e-1", event: nodeCreated("n1") },
        { eventId: "e-2", event: nodeCreated("n2") }
      ],
      applyGraphEvents: (events) => applied.push(...events),
      log: () => undefined
    });

    expect(replay.appliedCount).toBe(0);
    expect(replay.duplicateCount).toBe(2);
    expect(state.cursor.graphSeq).toBe(3);
    expect(applied).toHaveLength(2);
  });

  it("mixed poll/subscribe/replay permutations converge to identical normalized state", () => {
    const permutations: Array<Array<"poll" | "sse" | "replay">> = [
      ["poll", "sse", "replay"],
      ["sse", "replay", "poll"],
      ["replay", "poll", "sse"]
    ];

    const snapshots = permutations.map((order) => {
      const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
      const nodes = new Set<string>();
      for (const source of order) {
        const candidateCursor = source === "poll" ? { metaSeq: 0, graphSeq: 1 } : source === "sse" ? { metaSeq: 0, graphSeq: 2 } : { metaSeq: 0, graphSeq: 3 };
        const events = [
          { eventId: "e-1", event: nodeCreated("n1") },
          { eventId: "e-2", event: nodeCreated("n2") }
        ];
        applyGuardedSyncBatch({
          graphSpaceId: "space-a",
          state,
          source,
          candidateCursor,
          events,
          applyGraphEvents: (batch) => {
            for (const event of batch) {
              if (event.type === "graph.node.created") nodes.add(event.node.id);
            }
          },
          log: () => undefined
        });
      }
      return JSON.stringify({ cursor: state.cursor, nodes: [...nodes].sort() });
    });

    expect(new Set(snapshots).size).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { GraphEvent } from "../src/graphStore.js";
import { applyGuardedSyncBatch, type SyncIngestionState } from "../src/syncIngestion.js";

function nodeCreated(id: string): GraphEvent {
  return { type: "graph.node.created", node: { id, label: id } };
}

describe("sync ingestion dedup across transports", () => {
  it("duplicate delivered by subscribe then poll applies once", () => {
    const applied: GraphEvent[] = [];
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };

    const subscribe = applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "subscribe",
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

    expect(subscribe.appliedCount).toBe(1);
    expect(poll.appliedCount).toBe(0);
    expect(poll.duplicateCount).toBe(1);
    expect(applied).toHaveLength(1);
    expect(state.cursor.graphSeq).toBe(2);
  });

  it("overlapping poll/subscribe batches converge to deterministic state", () => {
    const run = (order: Array<"poll" | "subscribe">): string[] => {
      const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
      const applied: string[] = [];
      for (const [index, source] of order.entries()) {
        const events = source === "poll"
          ? [
              { eventId: "e-1", event: nodeCreated("n1") },
              { eventId: "e-2", event: nodeCreated("n2") },
              { eventId: "e-3", event: nodeCreated("n3") }
            ]
          : [{ eventId: "e-2", event: nodeCreated("n2") }];
        const candidateCursor = { metaSeq: 0, graphSeq: index + 1 };
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

    expect(run(["poll", "subscribe"])).toEqual(["n1", "n2", "n3"]);
    expect(run(["subscribe", "poll"])).toEqual(["n1", "n2", "n3"]);
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
      source: "pull",
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

  it("mixed poll/subscribe/pull permutations converge to identical normalized state", () => {
    const permutations: Array<Array<"poll" | "subscribe" | "pull">> = [
      ["poll", "subscribe", "pull"],
      ["subscribe", "pull", "poll"],
      ["pull", "poll", "subscribe"]
    ];

    const snapshots = permutations.map((order) => {
      const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
      const nodes = new Set<string>();
      for (const source of order) {
        const candidateCursor = source === "poll" ? { metaSeq: 0, graphSeq: 1 } : source === "subscribe" ? { metaSeq: 0, graphSeq: 2 } : { metaSeq: 0, graphSeq: 3 };
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

  it("routes all transports through a single guarded ingestion gate", () => {
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
    const applyGraphEvents = vi.fn<(events: GraphEvent[]) => void>();

    const transports: Array<"poll" | "subscribe" | "pull"> = ["poll", "subscribe", "pull"];
    for (const [idx, source] of transports.entries()) {
      applyGuardedSyncBatch({
        graphSpaceId: "space-a",
        state,
        source,
        candidateCursor: { metaSeq: 0, graphSeq: idx + 1 },
        events: [{ eventId: `e-${idx}`, event: nodeCreated(`n${idx}`) }],
        applyGraphEvents,
        log: () => undefined
      });
    }

    expect(applyGraphEvents).toHaveBeenCalledTimes(3);
  });

  it("duplicate does not trigger extra side effects", () => {
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
    const sideEffect = vi.fn<(events: GraphEvent[]) => void>();

    applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "subscribe",
      candidateCursor: { metaSeq: 0, graphSeq: 1 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: sideEffect,
      log: () => undefined
    });

    applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "poll",
      candidateCursor: { metaSeq: 0, graphSeq: 2 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: sideEffect,
      log: () => undefined
    });

    expect(sideEffect).toHaveBeenCalledTimes(1);
  });

  it("emits structured ghost guard logs for applied, duplicate, and cursor events", () => {
    const state: SyncIngestionState = { cursor: { metaSeq: 0, graphSeq: 0 }, seenEventIdsByGraphSpace: new Map() };
    const logs: Array<{ message: string; detail: Record<string, unknown> }> = [];

    applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "poll",
      candidateCursor: { metaSeq: 0, graphSeq: 1 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: () => undefined,
      log: (message, detail) => logs.push({ message, detail })
    });

    applyGuardedSyncBatch({
      graphSpaceId: "space-a",
      state,
      source: "subscribe",
      candidateCursor: { metaSeq: 0, graphSeq: 2 },
      events: [{ eventId: "e-1", event: nodeCreated("n1") }],
      applyGraphEvents: () => undefined,
      log: (message, detail) => logs.push({ message, detail })
    });

    expect(logs.some((entry) => entry.message === "GHOST_GUARD_EVENT_APPLIED" && entry.detail.eventId === "e-1")).toBe(true);
    expect(logs.some((entry) => entry.message === "GHOST_GUARD_DUPLICATE_IGNORED" && entry.detail.eventId === "e-1")).toBe(true);
    expect(logs.some((entry) => entry.message === "GHOST_GUARD_BATCH_PROCESSED" && entry.detail.duplicateCount === 1)).toBe(true);
    expect(logs.some((entry) => entry.message === "GHOST_GUARD_CURSOR_ADVANCE" && entry.detail.graphSpaceId === "space-a")).toBe(true);
  });
});

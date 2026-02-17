import { describe, expect, it, vi } from "vitest";
import { createGraphStore, type GraphEvent } from "../../packages/mesh-explorer-ui/src/graphStore.js";
import { compareCursor, isCursorStrictlyAdvanced, persistCursorSafely, rotateAbortController } from "../../packages/mesh-explorer-ui/src/syncGuards.js";

describe("mesh explorer phase 18 hardening", () => {
  it("status updates emit store snapshots and can drive DOM text", () => {
    const store = createGraphStore();
    const dom = { status: "" };
    const seen: string[] = [];

    const unsubscribe = store.subscribe((snapshot) => {
      seen.push(snapshot.connectionStatus);
      dom.status = snapshot.connectionStatus;
    });

    store.setConnectionStatus("connecting");
    expect(seen.at(-1)).toBe("connecting");
    expect(dom.status).toBe("connecting");

    store.setConnectionStatus("connected");
    expect(seen.at(-1)).toBe("connected");
    expect(dom.status).toBe("connected");

    unsubscribe();
  });

  it("cursor regression is rejected and persistence write is skipped", () => {
    const current = { metaSeq: 5, graphSeq: 10 };
    const regressive = { metaSeq: 5, graphSeq: 9 };

    expect(isCursorStrictlyAdvanced(current, regressive)).toBe(false);

    const write = vi.fn<(key: string, value: string) => void>();
    if (isCursorStrictlyAdvanced(current, regressive)) {
      persistCursorSafely("mesh.cursor.alice.space", regressive, write);
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("persist cursor tolerates storage failures", () => {
    const write = vi.fn<(key: string, value: string) => void>(() => {
      throw new Error("quota");
    });

    const ok = persistCursorSafely("mesh.cursor.alice.space", { metaSeq: 1, graphSeq: 2 }, write);
    expect(ok).toBe(false);

    const store = createGraphStore();
    const events: GraphEvent[] = [{ type: "graph.node.created", node: { id: "n1", label: "node" } }];
    store.applyGraphEvents(events);
    expect(store.getState().nodesById.size).toBe(1);
  });

  it("compare cursor is lexicographic on (metaSeq, graphSeq)", () => {
    expect(compareCursor({ metaSeq: 1, graphSeq: 0 }, { metaSeq: 0, graphSeq: 999 })).toBeGreaterThan(0);
    expect(compareCursor({ metaSeq: 1, graphSeq: 1 }, { metaSeq: 1, graphSeq: 1 })).toBe(0);
    expect(compareCursor({ metaSeq: 1, graphSeq: 1 }, { metaSeq: 1, graphSeq: 2 })).toBeLessThan(0);
  });

  it("re-delivery and poll/sse overlap stay idempotent when cursor does not advance", () => {
    const store = createGraphStore();
    const createNode: GraphEvent = { type: "graph.node.created", node: { id: "n1", label: "first" } };

    const pollCursorAfter = { metaSeq: 0, graphSeq: 1 };
    if (isCursorStrictlyAdvanced(store.getState().cursor, pollCursorAfter)) {
      store.setCursor(pollCursorAfter);
      store.applyGraphEvents([createNode]);
    }

    const afterPoll = store.getState();
    expect(afterPoll.nodesById.size).toBe(1);

    const sseCursorAfter = { metaSeq: 0, graphSeq: 1 };
    if (isCursorStrictlyAdvanced(store.getState().cursor, sseCursorAfter)) {
      store.setCursor(sseCursorAfter);
      store.applyGraphEvents([createNode]);
    }

    const afterOverlap = store.getState();
    expect(afterOverlap.nodesById.size).toBe(1);

    if (isCursorStrictlyAdvanced(store.getState().cursor, sseCursorAfter)) {
      store.applyGraphEvents([createNode]);
    }
    expect(store.getState().nodesById.size).toBe(1);
  });

  it("double connect rotation aborts prior loop controller", () => {
    const first = rotateAbortController(null);
    expect(first.signal.aborted).toBe(false);

    const second = rotateAbortController(first);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });
});

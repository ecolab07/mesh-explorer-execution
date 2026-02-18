import { describe, expect, it, vi } from "vitest";
import { InMemoryLocalEventStore } from "../../packages/eventstore-local/src/InMemoryLocalEventStore.js";
import { HEARTBEAT_INTERVAL_MS, LocalSyncGateway } from "../../packages/sync-local/src/internal/transportGateway.js";
import { SUBSCRIBE_RETRY_DELAY_MS } from "../../packages/mesh-explorer-ui/src/syncConfig.js";

describe("sync subscribe timing controls", () => {
  it("uses 5s heartbeat interval by default", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(5000);
  });

  it("emits heartbeat around the configured 5s interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const gateway = new LocalSyncGateway(new InMemoryLocalEventStore(), {
      graphSpaceId: "mesh-explorer-graph-v1"
    });

    const iterator = gateway
      .syncSubscribe("mesh-explorer-graph-v1", { principalId: "alice" }, 0, { pollIntervalMs: 25 })
      [Symbol.asyncIterator]();

    let settled = false;
    const nextFrame = iterator.next().then((frame) => {
      settled = true;
      return frame;
    });

    await vi.advanceTimersByTimeAsync(4900);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(150);
    const frame = await nextFrame;
    expect(frame.value?.kind).toBe("heartbeat");

    await iterator.return?.();
    vi.useRealTimers();
  });

  it("paces subscribe retries at 1s", () => {
    expect(SUBSCRIBE_RETRY_DELAY_MS).toBe(1000);
  });
});

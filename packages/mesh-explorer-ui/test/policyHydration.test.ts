import { describe, expect, it } from "vitest";

import { createPolicyHydrationController, toEffectiveRetentionPolicy } from "../src/policyHydration.js";

describe("policy hydration", () => {
  it("uses defaults only as fallback when server policy is missing", () => {
    const effective = toEffectiveRetentionPolicy(undefined);
    expect(effective.ttlSeconds).toBe(86400);
    expect(effective.maxEvents).toBe(20000);
    expect(effective.snapshotEveryNEvents).toBe(500);
    expect(effective.snapshotEverySeconds).toBe(300);
    expect(effective.minSnapshotsToKeep).toBe(3);
  });

  it("hydrates latest selected scope and drops stale responses", async () => {
    let resolveA: ((value: { ttlSeconds: number; snapshotEveryNEvents: number; snapshotEverySeconds: number; minSnapshotsToKeep: number }) => void) | undefined;
    let resolveB: ((value: { ttlSeconds: number; snapshotEveryNEvents: number; snapshotEverySeconds: number; minSnapshotsToKeep: number }) => void) | undefined;
    let aCallCount = 0;

    const controller = createPolicyHydrationController(async (scopeId) => {
      if (scopeId === "project-a") {
        aCallCount += 1;
        if (aCallCount === 1) {
          return await new Promise((resolve) => {
            resolveA = resolve;
          });
        }
        return { ttlSeconds: 777, snapshotEveryNEvents: 7, snapshotEverySeconds: 70, minSnapshotsToKeep: 4 };
      }
      return await new Promise((resolve) => {
        resolveB = resolve;
      });
    });

    const pendingA = controller.hydrate("project-a");
    const pendingB = controller.hydrate("project-b");

    resolveB?.({ ttlSeconds: 111, snapshotEveryNEvents: 9, snapshotEverySeconds: 33, minSnapshotsToKeep: 2 });
    const hydratedB = await pendingB;
    expect(hydratedB?.scopeId).toBe("project-b");
    expect(hydratedB?.policy.ttlSeconds).toBe(111);

    resolveA?.({ ttlSeconds: 999, snapshotEveryNEvents: 5, snapshotEverySeconds: 10, minSnapshotsToKeep: 1 });
    const hydratedA = await pendingA;
    expect(hydratedA).toBeNull();

    const hydratedAReload = await controller.hydrate("project-a");
    expect(hydratedAReload?.scopeId).toBe("project-a");
    expect(hydratedAReload?.policy.ttlSeconds).toBe(777);
  });
});

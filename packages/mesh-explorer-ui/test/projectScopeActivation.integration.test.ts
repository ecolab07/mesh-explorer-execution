import { describe, expect, it } from "vitest";

import { activateProjectScope } from "../src/projectScopeActivation.js";

describe("project scope activation", () => {
  it("sets active project, updates scope debug context, and hydrates policy exactly once", async () => {
    const calls: string[] = [];
    const createdProjectId = "project-created-01";
    let activeProjectId = "project-old";
    let hydrationCount = 0;

    const meshDebugDump = () => ({ projectId: activeProjectId });

    await activateProjectScope(createdProjectId, {
      setActiveProject(projectId) {
        calls.push(`setActiveProject:${projectId}`);
        activeProjectId = projectId;
      },
      updateRouteSelection(projectId) {
        calls.push(`updateRouteSelection:${projectId}`);
      },
      async hydrateScopePolicy(projectId) {
        calls.push(`hydrateScopePolicy:${projectId}`);
        hydrationCount += 1;
      },
      async bootstrapScopeSync(projectId) {
        calls.push(`bootstrapScopeSync:${projectId}`);
      }
    });

    expect(meshDebugDump().projectId).toBe(createdProjectId);
    expect(hydrationCount).toBe(1);
    expect(calls).toEqual([
      "setActiveProject:project-created-01",
      "updateRouteSelection:project-created-01",
      "hydrateScopePolicy:project-created-01",
      "bootstrapScopeSync:project-created-01"
    ]);
  });
});

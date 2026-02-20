import { describe, expect, it } from "vitest";
import { buildMultiDeletePlan } from "../src/deleteSelection.js";

describe("buildMultiDeletePlan", () => {
  it("returns node-only deletions in stable order", () => {
    const plan = buildMultiDeletePlan({
      selectedNodeIds: new Set(["n2", "n1"]),
      linksById: new Map([
        ["l1", { id: "l1", source: "n1", target: "n2", type: "related" }]
      ])
    }, new Set());

    expect(plan).toEqual({ nodeIds: ["n1", "n2"], linkIds: [] });
  });

  it("drops selected links already removed by selected-node cascade", () => {
    const plan = buildMultiDeletePlan({
      selectedNodeIds: new Set(["n1", "n2"]),
      linksById: new Map([
        ["l1", { id: "l1", source: "n1", target: "n2", type: "related" }],
        ["l2", { id: "l2", source: "n3", target: "n4", type: "related" }]
      ])
    }, new Set(["l2", "l1"]));

    expect(plan).toEqual({ nodeIds: ["n1", "n2"], linkIds: ["l2"] });
  });
});

import { describe, expect, it } from "vitest";
import { exportGraphFromState, parseExportedGraph } from "../src/devtools/graphIo.js";

describe("graph io", () => {
  it("serializes minimal graph payload from state", () => {
    const payload = exportGraphFromState({
      nodesById: new Map([
        ["n1", { id: "n1", label: "Alpha", level: 1, metadata: { env: "test" } }],
        ["n2", { id: "n2", label: "Beta" }]
      ]),
      linksById: new Map([
        ["l1", { id: "l1", source: "n1", target: "n2", type: "related", label: "edge" }]
      ])
    });

    expect(payload).toEqual({
      version: 1,
      nodes: [
        { id: "n1", label: "Alpha", level: 1, metadata: { env: "test" } },
        { id: "n2", label: "Beta", level: undefined, metadata: undefined }
      ],
      links: [
        { id: "l1", source: "n1", target: "n2", type: "related", label: "edge" }
      ]
    });
  });

  it("rejects links referencing unknown nodes", () => {
    expect(() => parseExportedGraph({
      version: 1,
      nodes: [{ id: "n1", label: "Alpha" }],
      links: [{ id: "l1", source: "n1", target: "n2", type: "related" }]
    })).toThrow(/references unknown node/);
  });
});

import { describe, expect, it } from "vitest";
import { createGraphStore } from "../../packages/mesh-explorer-ui/src/graphStore.js";

describe("mesh explorer ui store", () => {
  it("emits on cursor set to support bootstrap-only renders", () => {
    const store = createGraphStore();
    let observed = 0;

    const unsubscribe = store.subscribe(() => {
      observed += 1;
    });

    store.setCursor({ metaSeq: 0, graphSeq: 0 });
    store.setCursor({ metaSeq: 0, graphSeq: 1 });

    unsubscribe();
    expect(observed).toBeGreaterThanOrEqual(3);
  });

  it("applies rename, deleteLink and deleteNode cascade", () => {
    const store = createGraphStore();
    store.applyGraphEvents([
      { type: "graph.node.created", node: { id: "A", label: "A" } },
      { type: "graph.node.created", node: { id: "B", label: "B" } },
      { type: "graph.link.created", link: { id: "L", source: "A", target: "B", type: "related" } }
    ]);

    store.applyGraphEvents([{ type: "graph.node.label.updated", nodeId: "A", label: "A2" }]);
    expect(store.getState().nodesById.get("A")?.label).toBe("A2");

    store.applyGraphEvents([{ type: "graph.link.deleted", linkId: "L" }]);
    expect(store.getState().linksById.has("L")).toBe(false);

    store.applyGraphEvents([
      { type: "graph.link.created", link: { id: "L2", source: "A", target: "B", type: "related" } },
      { type: "graph.node.deleted", nodeId: "A" }
    ]);

    expect(store.getState().nodesById.has("A")).toBe(false);
    expect(store.getState().linksById.has("L2")).toBe(false);
  });

});

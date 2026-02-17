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
});

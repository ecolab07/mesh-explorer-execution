import { describe, expect, it } from "vitest";

import { computeStateDigest, makeBootstrapCacheRecord, readBootstrapCacheRecord } from "../src/bootstrapCache.js";

describe("bootstrap cache digest", () => {
  it("is stable for identical projection", () => {
    const projection = {
      version: 1 as const,
      nodes: [
        { id: "n2", label: "B" },
        { id: "n1", label: "A", metadata: { z: 1, a: "x" } }
      ],
      links: [{ id: "l1", source: "n1", target: "n2", type: "depends" }]
    };
    expect(computeStateDigest(projection)).toBe(computeStateDigest(projection));
  });

  it("is insensitive to input iteration order", () => {
    const first = {
      version: 1 as const,
      nodes: [
        { id: "n2", label: "B" },
        { id: "n1", label: "A" }
      ],
      links: [{ id: "l1", source: "n1", target: "n2", type: "depends" }]
    };
    const second = {
      version: 1 as const,
      nodes: [
        { id: "n1", label: "A" },
        { id: "n2", label: "B" }
      ],
      links: [{ id: "l1", source: "n1", target: "n2", type: "depends" }]
    };
    expect(computeStateDigest(first)).toBe(computeStateDigest(second));
  });

  it("changes when visible projection changes", () => {
    const base = {
      version: 1 as const,
      nodes: [{ id: "n1", label: "A" }],
      links: []
    };
    const changed = {
      version: 1 as const,
      nodes: [{ id: "n1", label: "A*" }],
      links: []
    };
    expect(computeStateDigest(base)).not.toBe(computeStateDigest(changed));
  });

  it("rejects malformed stored cache payload", () => {
    const valid = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );
    const malformed = JSON.stringify({ ...valid, projection: { version: 2, nodes: [], links: [] } });
    const read = readBootstrapCacheRecord("mesh.bootstrapCache.alice.g1", (key) => (key ? malformed : null));
    expect(read).toBeNull();
  });
});

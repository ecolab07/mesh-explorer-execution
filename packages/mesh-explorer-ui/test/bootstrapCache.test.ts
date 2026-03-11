import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_PROJECTION_VERSION,
  BOOTSTRAP_SNAPSHOT_VERSION,
  computeStateDigest,
  makeBootstrapCacheRecord,
  persistBootstrapCacheRecord,
  readBootstrapCacheRecord
} from "../src/bootstrapCache.js";

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

  it("persists snapshotVersion in bootstrap metadata", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );

    expect(record.snapshotVersion).toBe(BOOTSTRAP_SNAPSHOT_VERSION);
  });
  it("persists projectionVersion in bootstrap metadata", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );

    expect(record.projectionVersion).toBe(BOOTSTRAP_PROJECTION_VERSION);
  });

  it("restores projectionVersion through storage round-trip", () => {
    const stored = JSON.stringify(
      makeBootstrapCacheRecord(
        { metaSeq: 1, graphSeq: 3 },
        { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
      )
    );

    const read = readBootstrapCacheRecord("mesh.bootstrapCache.alice.g1", () => stored);
    expect(read?.projectionVersion).toBe(BOOTSTRAP_PROJECTION_VERSION);
  });

  it("persists graphSpaceId and principal in bootstrap metadata", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] },
      { graphSpaceId: "g1", principal: "alice" }
    );

    expect(record.graphSpaceId).toBe("g1");
    expect(record.principal).toBe("alice");
  });

  it("restores graphSpaceId and principal through storage round-trip", () => {
    const stored = JSON.stringify(
      makeBootstrapCacheRecord(
        { metaSeq: 1, graphSeq: 3 },
        { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] },
        { graphSpaceId: "g1", principal: "alice" }
      )
    );

    const read = readBootstrapCacheRecord("mesh.bootstrapCache.alice.g1", () => stored);
    expect(read?.graphSpaceId).toBe("g1");
    expect(read?.principal).toBe("alice");
  });

  it("fails safe when durable cursor marker write fails after cache write", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );
    const writes = new Map<string, string>();
    const removed: string[] = [];
    const result = persistBootstrapCacheRecord(
      "mesh.bootstrapCache.alice.g1",
      "mesh.cursor.alice.g1",
      record,
      (key, value) => {
        if (key.includes("cursor")) throw new Error("cursor write failed");
        writes.set(key, value);
      },
      (key) => {
        removed.push(key);
        writes.delete(key);
      }
    );

    expect(result).toEqual({ committed: false, phase: "cursor-write-failed" });
    expect(writes.has("mesh.bootstrapCache.alice.g1")).toBe(false);
    expect(removed).toContain("mesh.bootstrapCache.alice.g1");
  });

  it("reports cache write failure and does not attempt cursor write", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );
    let writeCalls = 0;
    const writtenKeys: string[] = [];
    const result = persistBootstrapCacheRecord(
      "mesh.bootstrapCache.alice.g1",
      "mesh.cursor.alice.g1",
      record,
      (key) => {
        writeCalls += 1;
        writtenKeys.push(key);
        throw new Error("cache write failed");
      },
      () => undefined
    );

    expect(result).toEqual({ committed: false, phase: "cache-write-failed" });
    expect(writeCalls).toBe(1);
    expect(writtenKeys).toEqual(["mesh.bootstrapCache.alice.g1"]);
  });

  it("commits only when cache and cursor marker both persist", () => {
    const record = makeBootstrapCacheRecord(
      { metaSeq: 1, graphSeq: 3 },
      { version: 1, nodes: [{ id: "n1", label: "A" }], links: [] }
    );
    const writes = new Map<string, string>();
    const result = persistBootstrapCacheRecord(
      "mesh.bootstrapCache.alice.g1",
      "mesh.cursor.alice.g1",
      record,
      (key, value) => writes.set(key, value),
      () => undefined
    );

    expect(result).toEqual({ committed: true, phase: "committed" });
    expect(writes.has("mesh.bootstrapCache.alice.g1")).toBe(true);
    expect(writes.has("mesh.cursor.alice.g1")).toBe(true);
  });

});

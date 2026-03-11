import { describe, expect, it } from "vitest";
import { resolveBootstrapSnapshotSelectionDetails } from "../src/bootstrapSnapshotObservability.js";

describe("resolveBootstrapSnapshotSelectionDetails", () => {
  it("returns selected snapshot metadata using zero-based snapshotIndex", () => {
    const details = resolveBootstrapSnapshotSelectionDetails(
      "snapshot-b",
      { metaSeq: 0, graphSeq: 43 },
      [{ snapshotId: "snapshot-a" }, { snapshotId: "snapshot-b" }, { snapshotId: "snapshot-c" }]
    );

    expect(details).toEqual({
      snapshotId: "snapshot-b",
      snapshotIndex: 1,
      snapshotCount: 3,
      snapshotCursor: { metaSeq: 0, graphSeq: 43 }
    });
  });

  it("returns null when there is no selected snapshot match", () => {
    expect(resolveBootstrapSnapshotSelectionDetails(null, { metaSeq: 0, graphSeq: 0 }, [{ snapshotId: "snapshot-a" }])).toBeNull();
    expect(resolveBootstrapSnapshotSelectionDetails("snapshot-z", { metaSeq: 0, graphSeq: 0 }, [{ snapshotId: "snapshot-a" }])).toBeNull();
  });
});

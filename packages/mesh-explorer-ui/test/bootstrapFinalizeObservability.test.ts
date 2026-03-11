import { describe, expect, it, vi } from "vitest";

import { emitBootstrapFinalizeCommitLogs } from "../src/bootstrapFinalizeObservability.js";

describe("emitBootstrapFinalizeCommitLogs", () => {
  it("emits finalize logs in protocol order", () => {
    const emitLog = vi.fn<(message: string, detail: unknown) => void>();
    const finalCursor = { metaSeq: 0, graphSeq: 42 };

    emitBootstrapFinalizeCommitLogs(emitLog, {
      source: "bootstrap-finalize",
      finalCursor,
      projectionVersion: 1
    });

    expect(emitLog.mock.calls).toEqual([
      [
        "BOOTSTRAP_CACHE_WRITE_COMMITTED",
        {
          source: "bootstrap-finalize",
          cursor: finalCursor
        }
      ],
      [
        "BOOTSTRAP_CACHE_PERSISTED",
        {
          source: "bootstrap-finalize",
          cursor: finalCursor,
          projectionVersion: 1
        }
      ],
      [
        "BOOTSTRAP_FINALIZE_DURABLE_PERSIST_SUCCEEDED",
        {
          source: "bootstrap-finalize",
          finalCursor
        }
      ],
      [
        "BOOTSTRAP_FINALIZE_CURSOR_EXPOSED",
        {
          source: "bootstrap-finalize",
          finalCursor
        }
      ]
    ]);
  });
});

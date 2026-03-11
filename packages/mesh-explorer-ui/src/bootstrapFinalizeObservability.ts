import type { Cursor } from "./graphStore.js";

type BootstrapFinalizeEmitLog = (message: string, detail: unknown) => void;

export function emitBootstrapFinalizeCommitLogs(
  emitLog: BootstrapFinalizeEmitLog,
  detail: {
    source: "bootstrap-finalize";
    finalCursor: Cursor;
    projectionVersion: number;
  }
): void {
  // Observability contract for bootstrap finalization:
  // cache write committed -> cache persisted -> durable protocol committed -> cursor exposed.
  emitLog("BOOTSTRAP_CACHE_WRITE_COMMITTED", {
    source: detail.source,
    cursor: detail.finalCursor
  });
  emitLog("BOOTSTRAP_CACHE_PERSISTED", {
    source: detail.source,
    cursor: detail.finalCursor,
    projectionVersion: detail.projectionVersion
  });
  emitLog("BOOTSTRAP_FINALIZE_DURABLE_PERSIST_SUCCEEDED", {
    source: detail.source,
    finalCursor: detail.finalCursor
  });
  emitLog("BOOTSTRAP_FINALIZE_CURSOR_EXPOSED", {
    source: detail.source,
    finalCursor: detail.finalCursor
  });
}

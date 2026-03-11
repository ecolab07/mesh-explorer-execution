export type SnapshotCursor = { metaSeq: number; graphSeq: number };

export type SnapshotSummary = { snapshotId: string };

export type BootstrapSnapshotSelectionDetails = {
  snapshotId: string;
  snapshotIndex: number;
  snapshotCount: number;
  snapshotCursor: SnapshotCursor;
};

/**
 * Returns zero-based snapshot ranking metadata for bootstrap observability.
 */
export function resolveBootstrapSnapshotSelectionDetails(
  selectedSnapshotId: string | null,
  selectedSnapshotCursor: SnapshotCursor,
  snapshots: SnapshotSummary[]
): BootstrapSnapshotSelectionDetails | null {
  if (!selectedSnapshotId || snapshots.length === 0) return null;
  const snapshotIndex = snapshots.findIndex((entry) => entry.snapshotId === selectedSnapshotId);
  if (snapshotIndex < 0) return null;
  return {
    snapshotId: selectedSnapshotId,
    snapshotIndex,
    snapshotCount: snapshots.length,
    snapshotCursor: selectedSnapshotCursor
  };
}

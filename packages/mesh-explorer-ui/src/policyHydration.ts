export type RetentionPolicy = {
  ttlSeconds?: number;
  maxEvents?: number;
  snapshotEveryNEvents: number;
  snapshotEverySeconds: number;
  minSnapshotsToKeep: number;
  mode: "delete" | "archive";
};

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  ttlSeconds: 86400,
  maxEvents: 20000,
  snapshotEveryNEvents: 500,
  snapshotEverySeconds: 300,
  minSnapshotsToKeep: 3,
  mode: "delete"
};

export function toEffectiveRetentionPolicy(raw?: Partial<RetentionPolicy> | null): RetentionPolicy {
  if (!raw) return { ...DEFAULT_RETENTION_POLICY };
  return {
    ttlSeconds: typeof raw.ttlSeconds === "number" && raw.ttlSeconds > 0 ? Math.floor(raw.ttlSeconds) : DEFAULT_RETENTION_POLICY.ttlSeconds,
    maxEvents: typeof raw.maxEvents === "number" && raw.maxEvents > 0 ? Math.floor(raw.maxEvents) : DEFAULT_RETENTION_POLICY.maxEvents,
    snapshotEveryNEvents: typeof raw.snapshotEveryNEvents === "number" && raw.snapshotEveryNEvents > 0
      ? Math.floor(raw.snapshotEveryNEvents)
      : DEFAULT_RETENTION_POLICY.snapshotEveryNEvents,
    snapshotEverySeconds: typeof raw.snapshotEverySeconds === "number" && raw.snapshotEverySeconds > 0
      ? Math.floor(raw.snapshotEverySeconds)
      : DEFAULT_RETENTION_POLICY.snapshotEverySeconds,
    minSnapshotsToKeep: typeof raw.minSnapshotsToKeep === "number" && raw.minSnapshotsToKeep > 0
      ? Math.floor(raw.minSnapshotsToKeep)
      : DEFAULT_RETENTION_POLICY.minSnapshotsToKeep,
    mode: raw.mode === "archive" ? "archive" : "delete"
  };
}

type FetchPolicy = (scopeId: string) => Promise<Partial<RetentionPolicy> | null | undefined>;

export function createPolicyHydrationController(fetchPolicy: FetchPolicy): {
  hydrate: (scopeId: string) => Promise<{ scopeId: string; policy: RetentionPolicy } | null>;
} {
  let requestSeq = 0;
  return {
    async hydrate(scopeId: string) {
      requestSeq += 1;
      const requestId = requestSeq;
      const raw = await fetchPolicy(scopeId);
      if (requestId !== requestSeq) return null;
      return { scopeId, policy: toEffectiveRetentionPolicy(raw) };
    }
  };
}

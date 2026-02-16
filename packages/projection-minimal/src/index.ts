import type { LocalEventStore } from "@mesh/eventstore-local";
import type { SnapshotEnvelope, SnapshotStore } from "@mesh/snapshot-minimal";
import { SNAPSHOT_VERSION_V1 } from "@mesh/snapshot-minimal";
import type { PrincipalContext } from "@mesh/shared";

export interface ProjectionSnapshot {
  principalId: string;
  cursor: number;
  nodeCount: number;
  txIds: string[];
}

export interface RebuildStats {
  appliedTxCount: number;
}

export type ProjectionSnapshotEnvelope = SnapshotEnvelope<ProjectionSnapshot>;

export class PrincipalProjectionEngine {
  private readonly cache = new Map<string, ProjectionSnapshot>();

  constructor(private readonly eventStore: LocalEventStore, private readonly graphSpaceId: string) {}

  async rebuild(principal: PrincipalContext): Promise<ProjectionSnapshot> {
    const rebuild = await this.rebuildInternal(principal, 0, [], Number.MAX_SAFE_INTEGER);
    this.cache.set(this.cacheKey(principal), rebuild.snapshot);
    return rebuild.snapshot;
  }

  async rebuildWithSnapshot(params: {
    principal: PrincipalContext;
    snapshotStore: SnapshotStore<ProjectionSnapshot>;
  }): Promise<{ snapshot: ProjectionSnapshot; replayStats: RebuildStats }> {
    const latest = await params.snapshotStore.loadLatestSnapshot({
      graphSpaceId: this.graphSpaceId,
      principalId: params.principal.principalId
    });

    const scopedLatest = this.isSnapshotReusable(latest) ? latest : null;
    const seed = scopedLatest?.payload;
    const seedCursor = scopedLatest?.cursorAt ?? 0;
    const seedTxIds = seed?.txIds ?? [];

    const rebuild = await this.rebuildInternal(params.principal, seedCursor, seedTxIds, Number.MAX_SAFE_INTEGER);

    const snapshotEnvelope: ProjectionSnapshotEnvelope = {
      snapshotId: `${this.graphSpaceId}:${params.principal.principalId}:${rebuild.snapshot.cursor}:${this.visibilityScope()}`,
      snapshotVersion: SNAPSHOT_VERSION_V1,
      graphSpaceId: this.graphSpaceId,
      principalId: params.principal.principalId,
      cursorAt: rebuild.snapshot.cursor,
      payload: rebuild.snapshot
    };
    await params.snapshotStore.saveSnapshot(snapshotEnvelope);

    this.cache.set(this.cacheKey(params.principal), rebuild.snapshot);
    return rebuild;
  }

  async incremental(principal: PrincipalContext): Promise<ProjectionSnapshot> {
    const prior = this.cache.get(this.cacheKey(principal)) ?? this.compute(principal.principalId, [], 0);
    const delta = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, prior.cursor, Number.MAX_SAFE_INTEGER, principal);
    const merged = this.compute(principal.principalId, [...prior.txIds, ...delta.txs.map(() => PROJECTION_PLACEHOLDER_TOKEN)], delta.cursor);
    this.cache.set(this.cacheKey(principal), merged);
    return merged;
  }

  invalidate(graphSpaceId: string): void {
    if (graphSpaceId === this.graphSpaceId) {
      this.cache.clear();
    }
  }

  private async rebuildInternal(
    principal: PrincipalContext,
    fromCursorExclusive: number,
    seedTxIds: string[],
    limit: number
  ): Promise<{ snapshot: ProjectionSnapshot; replayStats: RebuildStats }> {
    const { txs, cursor } = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, fromCursorExclusive, limit, principal);
    const txIds = [...seedTxIds, ...txs.map(() => PROJECTION_PLACEHOLDER_TOKEN)];
    return {
      snapshot: this.compute(principal.principalId, txIds, cursor),
      replayStats: { appliedTxCount: txs.length }
    };
  }

  private cacheKey(principal: PrincipalContext): string {
    return `${principal.principalId}::${this.visibilityScope()}`;
  }

  private visibilityScope(): string {
    return this.securityPolicyEnabled() ? `policy:${this.visibilityPolicyMode()}` : "policy:off";
  }

  private securityPolicyEnabled(): boolean {
    const mode = this.visibilityPolicyMode();
    return mode === "acl" || mode === "entity-secret";
  }

  private visibilityPolicyMode(): string | undefined {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return env?.MESH_TX_VISIBILITY_POLICY;
  }


  private isSnapshotReusable(snapshot: ProjectionSnapshotEnvelope | null): snapshot is ProjectionSnapshotEnvelope {
    if (!snapshot) return false;
    if (!this.securityPolicyEnabled()) return true;
    if (!snapshot.snapshotId.includes(":policy:")) return true;
    return snapshot.snapshotId.includes(`:${this.visibilityScope()}`);
  }

  private compute(principalId: string, txIds: string[], cursor: number): ProjectionSnapshot {
    return {
      principalId,
      cursor,
      txIds,
      nodeCount: txIds.length
    };
  }
}

const PROJECTION_PLACEHOLDER_TOKEN = "placeholder";

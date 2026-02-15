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
    this.cache.set(principal.principalId, rebuild.snapshot);
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

    const seed = latest?.payload;
    const seedCursor = latest?.cursorAt ?? 0;
    const seedTxIds = seed?.txIds ?? [];

    const rebuild = await this.rebuildInternal(params.principal, seedCursor, seedTxIds, Number.MAX_SAFE_INTEGER);

    const snapshotEnvelope: ProjectionSnapshotEnvelope = {
      snapshotId: `${this.graphSpaceId}:${params.principal.principalId}:${rebuild.snapshot.cursor}`,
      snapshotVersion: SNAPSHOT_VERSION_V1,
      graphSpaceId: this.graphSpaceId,
      principalId: params.principal.principalId,
      cursorAt: rebuild.snapshot.cursor,
      payload: rebuild.snapshot
    };
    await params.snapshotStore.saveSnapshot(snapshotEnvelope);

    this.cache.set(params.principal.principalId, rebuild.snapshot);
    return rebuild;
  }

  async incremental(principal: PrincipalContext): Promise<ProjectionSnapshot> {
    const prior = this.cache.get(principal.principalId) ?? this.compute(principal.principalId, [], 0);
    const delta = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, prior.cursor, Number.MAX_SAFE_INTEGER, principal);
    const merged = this.compute(principal.principalId, [...prior.txIds, ...delta.txs.map((tx) => tx.txId)], delta.cursor);
    this.cache.set(principal.principalId, merged);
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
    const txIds = [...seedTxIds, ...txs.map((tx) => tx.txId)];
    return {
      snapshot: this.compute(principal.principalId, txIds, cursor),
      replayStats: { appliedTxCount: txs.length }
    };
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

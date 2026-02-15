import type { LocalEventStore } from "@mesh/eventstore-local";
import type { SnapshotEnvelope, SnapshotStore } from "@mesh/snapshot-minimal";
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
export declare class PrincipalProjectionEngine {
    private readonly eventStore;
    private readonly graphSpaceId;
    private readonly cache;
    constructor(eventStore: LocalEventStore, graphSpaceId: string);
    rebuild(principal: PrincipalContext): Promise<ProjectionSnapshot>;
    rebuildWithSnapshot(params: {
        principal: PrincipalContext;
        snapshotStore: SnapshotStore<ProjectionSnapshot>;
    }): Promise<{
        snapshot: ProjectionSnapshot;
        replayStats: RebuildStats;
    }>;
    incremental(principal: PrincipalContext): Promise<ProjectionSnapshot>;
    invalidate(graphSpaceId: string): void;
    private rebuildInternal;
    private compute;
}

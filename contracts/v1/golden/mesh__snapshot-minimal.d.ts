import { type CommandErrorCategory, type GraphSpaceId, type PrincipalId } from "@mesh/shared";
export type SnapshotId = string;
export type SnapshotVersion = number;
export declare const SNAPSHOT_VERSION_V1 = 1;
export interface SnapshotEnvelope<TPayload = unknown> {
    snapshotId: SnapshotId;
    snapshotVersion: SnapshotVersion;
    graphSpaceId: GraphSpaceId;
    principalId: PrincipalId;
    cursorAt: number;
    stateHash?: string;
    payload: TPayload;
    createdAt?: string;
}
export interface SnapshotStore<TPayload = unknown> {
    saveSnapshot(snapshotEnvelope: SnapshotEnvelope<TPayload>): Promise<void>;
    loadLatestSnapshot(scope: {
        graphSpaceId: GraphSpaceId;
        principalId: PrincipalId;
    }): Promise<SnapshotEnvelope<TPayload> | null>;
}
export declare class SnapshotValidationError extends Error {
    readonly category: CommandErrorCategory;
    readonly reasonCode: "CMD.VALIDATION.SNAPSHOT.UNSUPPORTED_VERSION";
    constructor(snapshotVersion: number);
}
export declare class InMemorySnapshotStore<TPayload = unknown> implements SnapshotStore<TPayload> {
    private readonly byScope;
    saveSnapshot(snapshotEnvelope: SnapshotEnvelope<TPayload>): Promise<void>;
    loadLatestSnapshot(scope: {
        graphSpaceId: GraphSpaceId;
        principalId: PrincipalId;
    }): Promise<SnapshotEnvelope<TPayload> | null>;
}
export declare class FileBackedSnapshotStore<TPayload = unknown> implements SnapshotStore<TPayload> {
    private readonly filePath;
    private state;
    constructor(filePath: string);
    saveSnapshot(snapshotEnvelope: SnapshotEnvelope<TPayload>): Promise<void>;
    loadLatestSnapshot(scope: {
        graphSpaceId: GraphSpaceId;
        principalId: PrincipalId;
    }): Promise<SnapshotEnvelope<TPayload> | null>;
    private loadState;
    private persistState;
}

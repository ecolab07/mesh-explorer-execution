import { promises as fs } from "node:fs";
import path from "node:path";
import { REASON_CODES, type CommandErrorCategory, type GraphSpaceId, type PrincipalId } from "@mesh/shared";

export type SnapshotId = string;
export type SnapshotVersion = number;
export const SNAPSHOT_VERSION_V1 = 1;

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
  loadLatestSnapshot(scope: { graphSpaceId: GraphSpaceId; principalId: PrincipalId }): Promise<SnapshotEnvelope<TPayload> | null>;
}

export class SnapshotValidationError extends Error {
  readonly category: CommandErrorCategory = "VALIDATION";
  readonly reasonCode = REASON_CODES.UNSUPPORTED_SNAPSHOT_VERSION;

  constructor(snapshotVersion: number) {
    super(`Unsupported snapshot version: ${snapshotVersion}`);
  }
}

function key(graphSpaceId: string, principalId: string): string {
  return `${graphSpaceId}::${principalId}`;
}

function validateVersion(version: number): void {
  if (version !== SNAPSHOT_VERSION_V1) {
    throw new SnapshotValidationError(version);
  }
}

export class InMemorySnapshotStore<TPayload = unknown> implements SnapshotStore<TPayload> {
  private readonly byScope = new Map<string, SnapshotEnvelope<TPayload>>();

  async saveSnapshot(snapshotEnvelope: SnapshotEnvelope<TPayload>): Promise<void> {
    validateVersion(snapshotEnvelope.snapshotVersion);
    this.byScope.set(key(snapshotEnvelope.graphSpaceId, snapshotEnvelope.principalId), snapshotEnvelope);
  }

  async loadLatestSnapshot(scope: { graphSpaceId: GraphSpaceId; principalId: PrincipalId }): Promise<SnapshotEnvelope<TPayload> | null> {
    return this.byScope.get(key(scope.graphSpaceId, scope.principalId)) ?? null;
  }
}

type PersistedSnapshotState<TPayload> = {
  snapshots: SnapshotEnvelope<TPayload>[];
};

const EMPTY_STATE: PersistedSnapshotState<unknown> = { snapshots: [] };

export class FileBackedSnapshotStore<TPayload = unknown> implements SnapshotStore<TPayload> {
  private state: PersistedSnapshotState<TPayload> | null = null;

  constructor(private readonly filePath: string) {}

  async saveSnapshot(snapshotEnvelope: SnapshotEnvelope<TPayload>): Promise<void> {
    validateVersion(snapshotEnvelope.snapshotVersion);
    const state = await this.loadState();
    const scoped = state.snapshots.filter(
      (snapshot) => !(snapshot.graphSpaceId === snapshotEnvelope.graphSpaceId && snapshot.principalId === snapshotEnvelope.principalId)
    );
    scoped.push(snapshotEnvelope);
    state.snapshots = scoped;
    await this.persistState(state);
  }

  async loadLatestSnapshot(scope: { graphSpaceId: GraphSpaceId; principalId: PrincipalId }): Promise<SnapshotEnvelope<TPayload> | null> {
    const state = await this.loadState();
    const match = state.snapshots.find((snapshot) => snapshot.graphSpaceId === scope.graphSpaceId && snapshot.principalId === scope.principalId);
    if (!match) return null;
    validateVersion(match.snapshotVersion);
    return match;
  }

  private async loadState(): Promise<PersistedSnapshotState<TPayload>> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as PersistedSnapshotState<TPayload>;
    } catch (error) {
      const nodeErr = error as { code?: string };
      if (nodeErr.code === "ENOENT") {
        this.state = EMPTY_STATE as PersistedSnapshotState<TPayload>;
      } else {
        throw error;
      }
    }
    return this.state;
  }

  private async persistState(state: PersistedSnapshotState<TPayload>): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

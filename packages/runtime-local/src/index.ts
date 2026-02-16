import path from "node:path";
import { makePersistentEventStore, type LocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { PrincipalProjectionEngine, type ProjectionSnapshot } from "@mesh/projection-minimal";
import { FileBackedSnapshotStore, type SnapshotEnvelope } from "@mesh/snapshot-minimal";
import type { Command, CommandOutcome, PrincipalContext } from "@mesh/shared";

export type RuntimeLocalConfig = {
  rootDir: string;
  graphSpaceId: string;
  principalId: string;
  snapshotPolicy?: { minTx?: number; intervalMs?: number };
  replayBudget?: { maxTx?: number; maxMs?: number };
  quotas?: { maxLogBytes?: number; maxSnapshots?: number };
};

export type TxHead = string;

export type RuntimeState<TView = unknown> = {
  head: { tx: TxHead };
  view: TView;
};

export interface RuntimeLocal<TView = unknown> {
  start(): Promise<void>;
  stop(): Promise<void>;
  write(cmd: Command): Promise<CommandOutcome>;
  read(): Promise<RuntimeState<TView>>;
  status(): { started: boolean };
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

class RuntimeLocalImpl implements RuntimeLocal {
  private started = false;
  private readonly principal: PrincipalContext;
  private lastSnapshot: SnapshotEnvelope<ProjectionSnapshot> | null = null;

  constructor(
    private readonly config: RuntimeLocalConfig,
    private readonly eventStore: LocalEventStoreClosable,
    private readonly kernel: KernelMinimalImpl,
    private readonly projectionEngine: PrincipalProjectionEngine,
    private readonly snapshotStore: FileBackedSnapshotStore<ProjectionSnapshot>
  ) {
    this.principal = { principalId: config.principalId };
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (this.config.snapshotPolicy) {
      this.lastSnapshot = await this.snapshotStore.loadLatestSnapshot({
        graphSpaceId: this.config.graphSpaceId,
        principalId: this.principal.principalId
      });

      // Snapshot policy controls startup maintenance only; read() output must stay deterministic.
      const shouldCreateSnapshot = await this.shouldSnapshot();
      if (shouldCreateSnapshot) {
        const startedAt = Date.now();
        const rebuilt = await this.projectionEngine.rebuildWithSnapshot({
          principal: this.principal,
          snapshotStore: this.snapshotStore
        });
        this.enforceReplayBudget(rebuilt.replayStats.appliedTxCount, Date.now() - startedAt);
        this.lastSnapshot = await this.snapshotStore.loadLatestSnapshot({
          graphSpaceId: this.config.graphSpaceId,
          principalId: this.principal.principalId
        });
      } else {
        await this.projectionEngine.rebuild(this.principal);
      }
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.eventStore.close();
    this.started = false;
  }

  async write(cmd: Command): Promise<CommandOutcome> {
    this.assertStarted();
    return this.kernel.execute(cmd);
  }

  async read(): Promise<RuntimeState<ProjectionSnapshot>> {
    this.assertStarted();
    const view = await this.projectionEngine.incremental(this.principal);
    return {
      head: { tx: String(view.cursor) },
      view
    };
  }

  status(): { started: boolean } {
    return { started: this.started };
  }

  private async shouldSnapshot(): Promise<boolean> {
    if (!this.config.snapshotPolicy) return false;
    if (!this.lastSnapshot) return true;

    const principalHead = await this.eventStore.getPrincipalCursorHead(this.config.graphSpaceId, this.principal);
    const minTx = this.config.snapshotPolicy.minTx;
    if (typeof minTx === "number" && minTx > 0) {
      const txDelta = principalHead - this.lastSnapshot.cursorAt;
      if (txDelta < minTx) return false;
    }

    const intervalMs = this.config.snapshotPolicy.intervalMs;
    if (typeof intervalMs === "number" && intervalMs > 0) {
      const createdAtMs = this.lastSnapshot.createdAt ? Date.parse(this.lastSnapshot.createdAt) : Number.NaN;
      // Time gates snapshot maintenance only; it must never influence read() view contents.
      if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs < intervalMs) {
        return false;
      }
    }

    return true;
  }

  private enforceReplayBudget(appliedTxCount: number, elapsedMs: number): void {
    const maxTx = this.config.replayBudget?.maxTx;
    if (typeof maxTx === "number" && appliedTxCount > maxTx) {
      throw new RuntimeError(`Replay budget exceeded: appliedTxCount ${appliedTxCount} > maxTx ${maxTx}`);
    }

    const maxMs = this.config.replayBudget?.maxMs;
    if (typeof maxMs === "number" && elapsedMs > maxMs) {
      throw new RuntimeError(`Replay budget exceeded: elapsedMs ${elapsedMs} > maxMs ${maxMs}`);
    }
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new RuntimeError("Runtime not started");
    }
  }
}

type LocalEventStoreClosable = LocalEventStore & {
  close: () => Promise<void>;
};

function resolveBackend(): "persistent" | "indexeddb" {
  const requested = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.MESH_BACKEND
    ?.trim()
    .toLowerCase();
  return requested === "indexeddb" ? "indexeddb" : "persistent";
}

function resolveEventStoreTarget(config: RuntimeLocalConfig): string {
  if (resolveBackend() === "indexeddb") {
    return `indexeddb://${["mesh_local_v1", config.graphSpaceId].join("-")}`;
  }
  return path.join(config.rootDir, "eventstore", "events.json");
}

export async function createRuntimeLocal(config: RuntimeLocalConfig): Promise<RuntimeLocal> {
  const eventStorePath = resolveEventStoreTarget(config);
  const snapshotPath = path.join(config.rootDir, "snapshots", "snapshots.json");

  const eventStore = (await makePersistentEventStore(eventStorePath)) as LocalEventStoreClosable;
  const kernel = new KernelMinimalImpl(eventStore);
  const projectionEngine = new PrincipalProjectionEngine(eventStore, config.graphSpaceId);
  const snapshotStore = new FileBackedSnapshotStore<ProjectionSnapshot>(snapshotPath);

  return new RuntimeLocalImpl(config, eventStore, kernel, projectionEngine, snapshotStore);
}

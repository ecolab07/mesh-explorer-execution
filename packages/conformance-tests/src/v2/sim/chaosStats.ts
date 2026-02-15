import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConformanceBackend } from "../../backends.js";

const CHAOS_STATS_PATH = path.resolve("artifacts", "chaos-stats.json");

export type ChaosStatsRecord = {
  testId: string;
  seed: number;
  steps: number;
  backend: ConformanceBackend;
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  nbTxPrimary: number;
  nbTxReplicaA: number;
  nbTxReplicaB: number;
  convergenceReached: boolean;
  convergenceStep: number | null;
  failedInvariantId: string | null;
  failureStep: number | null;
  lastAction: string | null;
};

export async function recordChaosStats(next: ChaosStatsRecord): Promise<void> {
  await fs.mkdir(path.dirname(CHAOS_STATS_PATH), { recursive: true });

  let current: ChaosStatsRecord[] = [];
  try {
    const raw = await fs.readFile(CHAOS_STATS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      current = parsed as ChaosStatsRecord[];
    }
  } catch {
    current = [];
  }

  const key = `${next.testId}:${next.backend}:${next.seed}`;
  const merged = [...current.filter((record) => `${record.testId}:${record.backend}:${record.seed}` !== key), next];
  merged.sort((left, right) => {
    if (left.testId !== right.testId) return left.testId.localeCompare(right.testId);
    if (left.backend !== right.backend) return left.backend.localeCompare(right.backend);
    return left.seed - right.seed;
  });

  const stable = merged.map((record) => ({
    testId: record.testId,
    seed: record.seed,
    steps: record.steps,
    backend: record.backend,
    delivered: record.delivered,
    dropped: record.dropped,
    duplicated: record.duplicated,
    reordered: record.reordered,
    nbTxPrimary: record.nbTxPrimary,
    nbTxReplicaA: record.nbTxReplicaA,
    nbTxReplicaB: record.nbTxReplicaB,
    convergenceReached: record.convergenceReached,
    convergenceStep: record.convergenceStep,
    failedInvariantId: record.failedInvariantId,
    failureStep: record.failureStep,
    lastAction: record.lastAction
  }));

  await fs.writeFile(CHAOS_STATS_PATH, `${JSON.stringify(stable, null, 2)}\n`, "utf8");
}


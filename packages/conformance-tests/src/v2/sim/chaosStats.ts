import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConformanceBackend } from "../../backends.js";
import type { ChaosMode } from "./chaosConfig.js";

const CHAOS_STATS_PATH = path.resolve("artifacts", "chaos-stats.json");

export type ChaosStatsRecord = {
  testId: string;
  mode: ChaosMode;
  seed: number;
  steps: number;
  backend: ConformanceBackend;
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  partitions: number;
  heals: number;
  nbTxPrimary: number;
  nbTxReplicaA: number;
  nbTxReplicaB: number;
  convergenceReached: boolean;
  convergenceStep: number | null;
  failedInvariantId: string | null;
  failureStep: number | null;
  lastAction: string | null;
};

type ChaosStatsDocument = {
  mode: ChaosMode;
  backend: ConformanceBackend | "both";
  seeds: number[];
  steps: number;
  network: {
    delivered: number;
    dropped: number;
    duplicated: number;
    reordered: number;
    partitions: number;
    heals: number;
  };
  nbTx: {
    primary: number;
    replicas: number;
  };
  convergenceReached: boolean;
  convergenceStep: number | null;
  failure: {
    invariantId: string;
    seed: number;
    step: number | null;
    lastAction: string | null;
  } | null;
  records: ChaosStatsRecord[];
};

const runRecords = new Map<string, ChaosStatsRecord>();

export async function recordChaosStats(next: ChaosStatsRecord): Promise<void> {
  await fs.mkdir(path.dirname(CHAOS_STATS_PATH), { recursive: true });

  const key = `${next.testId}:${next.backend}:${next.seed}`;
  runRecords.set(key, next);
  const records = [...runRecords.values()].sort((left, right) => {
    if (left.testId !== right.testId) return left.testId.localeCompare(right.testId);
    if (left.backend !== right.backend) return left.backend.localeCompare(right.backend);
    return left.seed - right.seed;
  });

  const summary = summarize(records);
  await fs.writeFile(CHAOS_STATS_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function summarize(records: ChaosStatsRecord[]): ChaosStatsDocument {
  const latest = records.at(-1);
  const seeds = [...new Set(records.map((record) => record.seed))].sort((left, right) => left - right);
  const backends = [...new Set(records.map((record) => record.backend))];
  const failureRecord = [...records].reverse().find((record) => record.failedInvariantId !== null);

  return {
    mode: latest?.mode ?? "smoke",
    backend: backends.length === 1 ? backends[0] : "both",
    seeds,
    steps: latest?.steps ?? 0,
    network: records.reduce(
      (acc, record) => {
        acc.delivered += record.delivered;
        acc.dropped += record.dropped;
        acc.duplicated += record.duplicated;
        acc.reordered += record.reordered;
        acc.partitions += record.partitions;
        acc.heals += record.heals;
        return acc;
      },
      { delivered: 0, dropped: 0, duplicated: 0, reordered: 0, partitions: 0, heals: 0 }
    ),
    nbTx: {
      primary: records.reduce((sum, record) => sum + record.nbTxPrimary, 0),
      replicas: records.reduce((sum, record) => sum + record.nbTxReplicaA + record.nbTxReplicaB, 0)
    },
    convergenceReached: records.every((record) => record.convergenceReached),
    convergenceStep:
      records.length > 0 && records.every((record) => typeof record.convergenceStep === "number")
        ? Math.max(...records.map((record) => record.convergenceStep ?? 0))
        : null,
    failure: failureRecord
      ? {
          invariantId: failureRecord.failedInvariantId ?? "unknown",
          seed: failureRecord.seed,
          step: failureRecord.failureStep,
          lastAction: failureRecord.lastAction
        }
      : null,
    records
  };
}

import type { ConformanceBackend } from "../../backends.js";

type ChaosBackendMode = ConformanceBackend | "both";

const DEFAULT_SEEDS = [1, 2, 3, 4, 5];
const DEFAULT_STEPS = 200;
const DEFAULT_BACKEND: ChaosBackendMode = "inmemory";

export function getChaosSeeds(): number[] {
  const raw = process.env.MESH_CHAOS_SEEDS?.trim();
  if (!raw) return DEFAULT_SEEDS;

  const parsed = raw
    .split(",")
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((token) => Number.isFinite(token));

  if (parsed.length === 0) return DEFAULT_SEEDS;
  return parsed;
}

export function getChaosStepCount(): number {
  const raw = process.env.MESH_CHAOS_STEPS?.trim();
  if (!raw) return DEFAULT_STEPS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STEPS;
  return parsed;
}

export function getChaosBackendMode(): ChaosBackendMode {
  const raw = process.env.MESH_CHAOS_BACKEND?.trim().toLowerCase();
  if (raw === "inmemory" || raw === "persistent" || raw === "both") {
    return raw;
  }
  return DEFAULT_BACKEND;
}

export function getChaosBackends(): ConformanceBackend[] {
  const mode = getChaosBackendMode();
  if (mode === "both") return ["inmemory", "persistent"];
  return [mode];
}

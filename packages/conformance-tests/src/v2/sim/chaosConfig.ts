import type { ConformanceBackend } from "../../backends.js";

type ChaosBackendMode = ConformanceBackend | "both";
export type ChaosMode = "smoke" | "soak";

const SMOKE_SEEDS = [1, 2, 3, 4, 5];
const SOAK_SEEDS = Array.from({ length: 50 }, (_, index) => index + 1);
const SMOKE_STEPS = 200;
const SOAK_STEPS = 1000;
const SMOKE_BACKEND: ChaosBackendMode = "inmemory";
const SOAK_BACKEND: ChaosBackendMode = "persistent";

export function getChaosMode(): ChaosMode {
  return process.env.MESH_CHAOS_LEVEL?.trim().toLowerCase() === "soak" ? "soak" : "smoke";
}

function modeDefaults(mode: ChaosMode): { seeds: number[]; steps: number; backend: ChaosBackendMode } {
  if (mode === "soak") {
    return {
      seeds: SOAK_SEEDS,
      steps: SOAK_STEPS,
      backend: SOAK_BACKEND
    };
  }
  return {
    seeds: SMOKE_SEEDS,
    steps: SMOKE_STEPS,
    backend: SMOKE_BACKEND
  };
}

export function getChaosSeeds(): number[] {
  const defaults = modeDefaults(getChaosMode());
  const raw = process.env.MESH_CHAOS_SEEDS?.trim();
  if (!raw) return defaults.seeds;

  const parsed = raw
    .split(",")
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((token) => Number.isFinite(token));

  if (parsed.length === 0) return defaults.seeds;
  return parsed;
}

export function getChaosStepCount(): number {
  const defaults = modeDefaults(getChaosMode());
  const raw = process.env.MESH_CHAOS_STEPS?.trim();
  if (!raw) return defaults.steps;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaults.steps;
  return parsed;
}

export function getChaosBackendMode(): ChaosBackendMode {
  const defaults = modeDefaults(getChaosMode());
  const raw = process.env.MESH_CHAOS_BACKEND?.trim().toLowerCase();
  if (raw === "inmemory" || raw === "persistent" || raw === "both") {
    return raw;
  }
  return defaults.backend;
}

export function getChaosBackends(): ConformanceBackend[] {
  const mode = getChaosBackendMode();
  if (mode === "both") return ["inmemory", "persistent"];
  return [mode];
}

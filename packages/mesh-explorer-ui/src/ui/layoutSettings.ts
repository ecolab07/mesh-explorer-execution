import type { LayoutParams } from "../graphCanvas2d.js";

export type LayoutPreset = "Compact" | "Balanced" | "Spread" | "Snappy";
export type WarmupMode = "OFF" | "SOFT" | "HARD";

export type LayoutSettings = {
  preset: LayoutPreset;
  repulsion: number;
  edgeLength: number;
  reactivity: number;
  collision: number;
  warmupMode: WarmupMode;
};

export type DevPanelState = { open: boolean };

export type LayoutUiState = {
  settings: LayoutSettings;
  panel: DevPanelState;
};

const STORAGE_KEY = "mesh-explorer:layout-ui-state";

export const LAYOUT_LIMITS = {
  repulsion: { min: -800, max: -5 },
  edgeLength: { min: 10, max: 420 },
  reactivity: { min: 0.05, max: 2 },
  collision: { min: 2, max: 120 }
} as const;

const PRESETS: Record<LayoutPreset, Omit<LayoutSettings, "preset">> = {
  Compact: { repulsion: -48, edgeLength: 48, reactivity: 0.8, collision: 20, warmupMode: "SOFT" },
  Balanced: { repulsion: -58, edgeLength: 64, reactivity: 0.55, collision: 23, warmupMode: "HARD" },
  Spread: { repulsion: -82, edgeLength: 92, reactivity: 0.38, collision: 26, warmupMode: "SOFT" },
  Snappy: { repulsion: -52, edgeLength: 58, reactivity: 0.92, collision: 22, warmupMode: "OFF" }
};

export function defaultLayoutSettings(): LayoutSettings {
  return { preset: "Balanced", ...PRESETS.Balanced };
}

export function defaultLayoutUiState(): LayoutUiState {
  return { settings: defaultLayoutSettings(), panel: { open: false } };
}

export function applyPreset(preset: LayoutPreset, base: LayoutSettings): LayoutSettings {
  const values = PRESETS[preset];
  return { ...base, preset, ...values };
}

export function deriveLayoutParams(settings: LayoutSettings): LayoutParams {
  const reactivity = clamp(settings.reactivity, LAYOUT_LIMITS.reactivity.min, LAYOUT_LIMITS.reactivity.max);
  const chargeStrength = clamp(Math.abs(settings.repulsion), Math.abs(LAYOUT_LIMITS.repulsion.max), Math.abs(LAYOUT_LIMITS.repulsion.min));
  const linkDistance = clamp(settings.edgeLength, LAYOUT_LIMITS.edgeLength.min, LAYOUT_LIMITS.edgeLength.max);
  const collisionRadius = clamp(settings.collision, LAYOUT_LIMITS.collision.min, LAYOUT_LIMITS.collision.max);
  const reactivityNormalized = (reactivity - LAYOUT_LIMITS.reactivity.min) / (LAYOUT_LIMITS.reactivity.max - LAYOUT_LIMITS.reactivity.min);
  return {
    chargeStrength,
    linkDistance,
    linkStrength: 0.18,
    collisionRadius,
    centering: 0.03,
    alphaTarget: 0.04 + reactivityNormalized * 0.24,
    alphaDecay: 0.095 - reactivityNormalized * 0.075,
    velocityDecay: 0.36 - reactivityNormalized * 0.24,
    minAlpha: 0.0005
  };
}

export function serializeLayoutSettings(settings: LayoutSettings): LayoutSettings {
  return {
    preset: settings.preset,
    repulsion: settings.repulsion,
    edgeLength: settings.edgeLength,
    reactivity: settings.reactivity,
    collision: settings.collision,
    warmupMode: settings.warmupMode
  };
}

export function loadLayoutUiState(): LayoutUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayoutUiState();
    const parsed = JSON.parse(raw) as Partial<LayoutUiState>;
    const base = defaultLayoutUiState();
    const settings: Partial<LayoutSettings> = parsed.settings ?? {};
    return {
      settings: {
        preset: asPreset(settings.preset) ?? base.settings.preset,
        repulsion: clamp(asNumber(settings.repulsion) ?? base.settings.repulsion, LAYOUT_LIMITS.repulsion.min, LAYOUT_LIMITS.repulsion.max),
        edgeLength: clamp(asNumber(settings.edgeLength) ?? base.settings.edgeLength, LAYOUT_LIMITS.edgeLength.min, LAYOUT_LIMITS.edgeLength.max),
        reactivity: clamp(asNumber(settings.reactivity) ?? base.settings.reactivity, LAYOUT_LIMITS.reactivity.min, LAYOUT_LIMITS.reactivity.max),
        collision: clamp(asNumber(settings.collision) ?? base.settings.collision, LAYOUT_LIMITS.collision.min, LAYOUT_LIMITS.collision.max),
        warmupMode: asWarmupMode(settings.warmupMode) ?? base.settings.warmupMode
      },
      panel: { open: Boolean(parsed.panel?.open) }
    };
  } catch {
    return defaultLayoutUiState();
  }
}

export function saveLayoutUiState(state: LayoutUiState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: serializeLayoutSettings(state.settings), panel: state.panel }));
  } catch {
    // ignore localStorage failures
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPreset(value: unknown): LayoutPreset | null {
  return value === "Compact" || value === "Balanced" || value === "Spread" || value === "Snappy" ? value : null;
}

function asWarmupMode(value: unknown): WarmupMode | null {
  return value === "OFF" || value === "SOFT" || value === "HARD" ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

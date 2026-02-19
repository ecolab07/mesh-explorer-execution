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

const PRESETS: Record<LayoutPreset, Omit<LayoutSettings, "preset">> = {
  Compact: { repulsion: 48, edgeLength: 48, reactivity: 0.8, collision: 20, warmupMode: "SOFT" },
  Balanced: { repulsion: 58, edgeLength: 64, reactivity: 0.55, collision: 23, warmupMode: "HARD" },
  Spread: { repulsion: 82, edgeLength: 92, reactivity: 0.38, collision: 26, warmupMode: "SOFT" },
  Snappy: { repulsion: 52, edgeLength: 58, reactivity: 0.92, collision: 22, warmupMode: "OFF" }
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
  const reactivity = clamp(settings.reactivity, 0, 1);
  return {
    chargeStrength: settings.repulsion,
    linkDistance: settings.edgeLength,
    linkStrength: 0.18,
    collisionRadius: settings.collision,
    centering: 0.03,
    alphaTarget: 0.22 * reactivity,
    alphaDecay: 0.02 + (1 - reactivity) * 0.08,
    velocityDecay: 0.15 + (1 - reactivity) * 0.25,
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
        repulsion: asNumber(settings.repulsion) ?? base.settings.repulsion,
        edgeLength: asNumber(settings.edgeLength) ?? base.settings.edgeLength,
        reactivity: clamp(asNumber(settings.reactivity) ?? base.settings.reactivity, 0, 1),
        collision: asNumber(settings.collision) ?? base.settings.collision,
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

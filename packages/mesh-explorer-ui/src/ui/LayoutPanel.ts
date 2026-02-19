import { LAYOUT_LIMITS, applyPreset, serializeLayoutSettings, type DevPanelState, type LayoutPreset, type LayoutSettings, type WarmupMode } from "./layoutSettings.js";

type LayoutPanelCallbacks = {
  onSettingsChange: (next: LayoutSettings) => void;
  onPanelStateChange: (next: DevPanelState) => void;
  onReheat: () => void;
  onFit: () => void;
};

type LayoutPanelOptions = {
  enabled: boolean;
  settings: LayoutSettings;
  panel: DevPanelState;
};

export class LayoutPanel {
  private readonly root: HTMLDivElement;
  private readonly panelBody: HTMLDivElement;
  private settings: LayoutSettings;
  private panelState: DevPanelState;

  constructor(host: HTMLElement, options: LayoutPanelOptions, private readonly callbacks: LayoutPanelCallbacks) {
    this.settings = options.settings;
    this.panelState = options.panel;
    this.root = document.createElement("div");
    this.panelBody = document.createElement("div");
    if (!options.enabled) {
      this.root.style.display = "none";
      host.appendChild(this.root);
      return;
    }

    this.root.style.marginTop = "10px";
    this.root.style.border = "1px solid #ddd";
    this.root.style.borderRadius = "8px";
    this.root.style.padding = "8px";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "Layout";
    toggleBtn.onclick = () => {
      this.panelState = { open: !this.panelState.open };
      this.updateOpenState();
      this.callbacks.onPanelStateChange(this.panelState);
    };
    this.root.appendChild(toggleBtn);

    this.panelBody.style.marginTop = "8px";
    this.root.appendChild(this.panelBody);
    this.renderControls();
    this.updateOpenState();
    host.appendChild(this.root);
  }

  private renderControls(): void {
    this.panelBody.innerHTML = "";
    this.panelBody.appendChild(this.buildSelect("Preset", ["Compact", "Balanced", "Spread", "Snappy"], this.settings.preset, (value) => {
      this.settings = applyPreset(value as LayoutPreset, this.settings);
      this.callbacks.onSettingsChange(this.settings);
      this.renderControls();
    }));

    this.panelBody.appendChild(this.buildSlider("Repulsion", this.settings.repulsion, LAYOUT_LIMITS.repulsion.min, LAYOUT_LIMITS.repulsion.max, 1, (value) => this.updateSettings({ repulsion: value })));
    this.panelBody.appendChild(this.buildSlider("Edge length", this.settings.edgeLength, LAYOUT_LIMITS.edgeLength.min, LAYOUT_LIMITS.edgeLength.max, 1, (value) => this.updateSettings({ edgeLength: value })));
    this.panelBody.appendChild(this.buildSlider("Reactivity", this.settings.reactivity, LAYOUT_LIMITS.reactivity.min, LAYOUT_LIMITS.reactivity.max, 0.01, (value) => this.updateSettings({ reactivity: value })));
    this.panelBody.appendChild(this.buildSlider("Collision", this.settings.collision, LAYOUT_LIMITS.collision.min, LAYOUT_LIMITS.collision.max, 1, (value) => this.updateSettings({ collision: value })));
    this.panelBody.appendChild(this.buildSelect("Warmup", ["OFF", "SOFT", "HARD"], this.settings.warmupMode, (value) => this.updateSettings({ warmupMode: value as WarmupMode })));
    this.panelBody.appendChild(this.buildToggle("Debug logs", this.settings.debugLogs, (checked) => this.updateSettings({ debugLogs: checked })));

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.marginTop = "8px";

    const reheat = document.createElement("button");
    reheat.textContent = "Reheat";
    reheat.onclick = () => this.callbacks.onReheat();
    actions.appendChild(reheat);

    const fit = document.createElement("button");
    fit.textContent = "Fit";
    fit.onclick = () => this.callbacks.onFit();
    actions.appendChild(fit);

    const exportJson = document.createElement("button");
    exportJson.textContent = "Export JSON";
    exportJson.onclick = () => this.exportJson();
    actions.appendChild(exportJson);

    this.panelBody.appendChild(actions);
  }

  private updateSettings(patch: Partial<LayoutSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.callbacks.onSettingsChange(this.settings);
  }

  private updateOpenState(): void {
    this.panelBody.style.display = this.panelState.open ? "block" : "none";
  }

  private buildSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (next: number) => void
  ): HTMLElement {
    const row = document.createElement("label");
    row.style.display = "block";
    row.style.fontSize = "12px";
    row.style.marginTop = "6px";

    const valueLabel = document.createElement("span");
    valueLabel.style.float = "right";
    valueLabel.textContent = value.toFixed(step < 1 ? 2 : 0);

    const title = document.createElement("span");
    title.textContent = label;
    row.appendChild(title);
    row.appendChild(valueLabel);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = "100%";
    input.oninput = () => {
      const next = Number(input.value);
      valueLabel.textContent = next.toFixed(step < 1 ? 2 : 0);
      onChange(next);
    };
    row.appendChild(input);
    return row;
  }

  private buildSelect(label: string, options: string[], current: string, onChange: (next: string) => void): HTMLElement {
    const row = document.createElement("label");
    row.style.display = "block";
    row.style.marginTop = "6px";
    row.style.fontSize = "12px";
    row.textContent = label;

    const select = document.createElement("select");
    select.style.width = "100%";
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option;
      node.textContent = option;
      if (option === current) node.selected = true;
      select.appendChild(node);
    }
    select.onchange = () => onChange(select.value);
    row.appendChild(select);
    return row;
  }

  private buildToggle(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.marginTop = "8px";
    row.style.fontSize = "12px";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.onchange = () => onChange(input.checked);

    const text = document.createElement("span");
    text.textContent = label;

    row.appendChild(input);
    row.appendChild(text);
    return row;
  }

  private exportJson(): void {
    const payload = serializeLayoutSettings(this.settings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mesh-layout-settings.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}

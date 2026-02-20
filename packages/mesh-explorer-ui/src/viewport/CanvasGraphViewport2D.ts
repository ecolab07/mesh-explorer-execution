import {
  GraphCanvas2D,
  type CameraState,
  type CanvasUiState,
  type EdgeDraft,
  type LayoutParams,
  type Vec2
} from "../graphCanvas2d.js";
import type { GraphCanvasReadModel } from "../graphCanvas2d.js";
import type { GraphViewportActions, GraphViewportHandle, GraphViewportModel, GraphViewportOptions, Selection } from "./graphViewportContract.js";

export type CanvasGraphViewport2DOptions = {
  model: GraphViewportModel;
  actions: GraphViewportActions;
  options: GraphViewportOptions;
  uiState: CanvasUiState;
  camera: CameraState;
  onSelectionReplaceNodeIds: (ids: string[]) => void;
  onSelectionToggleNodeId: (id: string) => void;
  onSelectionClear: () => void;
  onSelectedLinkIdsChange: (ids: string[]) => void;
  onEdgeDraftChange: (edgeDraft: EdgeDraft | null) => void;
  onCameraChange: (camera: CameraState) => void;
  onFitRequest: () => void;
  layoutParams: Partial<LayoutParams>;
  warmupMode: "OFF" | "SOFT" | "HARD";
  debugLogsEnabled: boolean;
  debugLog: (event: string, payload?: Record<string, unknown>, throttleMs?: number) => void;
};

export class CanvasGraphViewport2D implements GraphViewportHandle {
  private readonly renderer: GraphCanvas2D;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly config: CanvasGraphViewport2DOptions) {
    this.renderer = new GraphCanvas2D(
      canvas,
      toReadModel(config.model),
      config.uiState,
      {
        onSelectionReplace: (ids) => {
          config.onSelectionReplaceNodeIds(ids);
          config.actions.onSelect(ids[0] ? { kind: "node", nodeId: ids[0] } : { kind: "none" });
        },
        onSelectionToggle: (id) => {
          config.onSelectionToggleNodeId(id);
          config.actions.onSelect({ kind: "node", nodeId: id });
        },
        onSelectionClear: () => {
          config.onSelectionClear();
          config.actions.onSelect({ kind: "none" });
        },
        onSelectedEdgeIdsChange: (ids) => {
          config.onSelectedLinkIdsChange(ids);
          config.actions.onSelect(ids[0] ? { kind: "link", linkId: ids[0] } : { kind: "none" });
        },
        onEdgeDraftChange: config.onEdgeDraftChange,
        onCreateEdge: (source, target) => config.actions.onCreateLink?.(source, target),
        onCameraChange: config.onCameraChange,
        onFitRequest: config.onFitRequest,
        onRequestDelete: (selection) => config.actions.onRequestDelete(toSelection(selection)),
        onRequestRename: (nodeId) => config.actions.onRequestRename(nodeId)
      },
      {
        layoutParams: config.layoutParams,
        warmupMode: config.warmupMode,
        debugLogsEnabled: config.debugLogsEnabled,
        debugLog: config.debugLog
      }
    );
  }

  update(model: GraphViewportModel, uiState: CanvasUiState): void {
    this.renderer.update(toReadModel(model), uiState);
  }

  destroy(): void {
    this.renderer.destroy();
  }

  resize(): void {
    this.renderer.resize();
  }

  setLayoutParams(params: Partial<LayoutParams>): void {
    this.renderer.setLayoutParams(params);
  }

  setWarmupMode(mode: "OFF" | "SOFT" | "HARD"): void {
    this.renderer.setWarmupMode(mode);
  }

  setDebugLogsEnabled(enabled: boolean): void {
    this.renderer.setDebugLogsEnabled(enabled);
  }

  getNodePositions(): Map<string, Vec2> {
    return this.renderer.getNodePositions();
  }

  fit(): void {
    this.config.onFitRequest();
  }

  reheat(alpha = 0.9): void {
    this.renderer.reheatLayout();
    if (alpha < 0.9) this.renderer.reheatLayout();
  }

  getPreferredSpawnWorldPos(): Vec2 {
    return this.renderer.getPreferredSpawnWorldPos();
  }

  seedNodePosition(nodeId: string, position: Vec2): void {
    this.renderer.seedNodePosition(nodeId, position);
  }

  nudgeZoomOut(factor = 0.96): void {
    this.renderer.nudgeZoomOut(factor);
  }

}

function toReadModel(model: GraphViewportModel): GraphCanvasReadModel {
  return {
    nodes: model.nodes,
    links: model.links,
    selectedNodeIds: model.selectedNodeIds ?? new Set(),
    selectedLinkIds: model.selectedLinkIds ?? new Set()
  };
}

function toSelection(selection: { kind: "none" } | { kind: "node"; nodeId: string } | { kind: "link"; linkId: string }): Selection {
  if (selection.kind === "node") return { kind: "node", nodeId: selection.nodeId };
  if (selection.kind === "link") return { kind: "link", linkId: selection.linkId };
  return { kind: "none" };
}

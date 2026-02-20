export type GraphId = string;

export type ViewNode = {
  id: GraphId;
  label: string;
  x?: number;
  y?: number;
  z?: number;
};

export type ViewLink = {
  id: GraphId;
  source: GraphId;
  target: GraphId;
  type: string;
  label?: string;
  curvature?: number;
};

export type Selection =
  | { kind: "none" }
  | { kind: "node"; nodeId: GraphId }
  | { kind: "link"; linkId: GraphId };

export type Connectivity = "online" | "degraded" | "offline";

export type GraphViewportModel = {
  nodes: ViewNode[];
  links: ViewLink[];
  selectedNodeIds?: Set<GraphId>;
  selectedLinkIds?: Set<GraphId>;
};

export type GraphViewportActions = {
  onSelect(sel: Selection): void;
  onRequestDelete(sel: Selection): void;
  onRequestRename(nodeId: GraphId): void;
  onCreateLink?(sourceId: GraphId, targetId: GraphId): void;
};

export type GraphViewportOptions = {
  connectivity: Connectivity;
  debug?: boolean;
  layout?: {
    repulsion?: number;
    edgeLength?: number;
    collision?: number;
    reactivity?: number;
    warmupMode?: "off" | "soft" | "hard";
  };
};

export type GraphViewportHandle = {
  fit(): void;
  reheat(alpha?: number): void;
  getPreferredSpawnWorldPos(): { x: number; y: number };
  seedNodePosition(nodeId: GraphId, position: { x: number; y: number }): void;
  nudgeZoomOut(factor?: number): void;
  exportLayoutJSON?(): unknown;
};

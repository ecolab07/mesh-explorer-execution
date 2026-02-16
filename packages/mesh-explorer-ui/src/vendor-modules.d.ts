declare module "react-force-graph-3d" {
  type GraphData = {
    nodes?: Array<{ id?: string; label?: string }>;
    links?: Array<{ source?: string; target?: string; type?: string }>;
  };

  type Instance = {
    nodeId: (value: string) => Instance;
    nodeLabel: (value: unknown) => Instance;
    linkLabel: (value: unknown) => Instance;
    linkColor: (value: unknown) => Instance;
    graphData: (value: GraphData) => Instance;
  };

  export default function ForceGraph3D(): (container: HTMLElement) => Instance;
}

declare module "force-graph" {
  type GraphData = {
    nodes?: Array<{ id?: string; label?: string }>;
    links?: Array<{ source?: string; target?: string; type?: string }>;
  };

  type Instance = {
    nodeId: (value: string) => Instance;
    nodeLabel: (value: unknown) => Instance;
    linkColor: (value: unknown) => Instance;
    graphData: (value: GraphData) => Instance;
  };

  export default function ForceGraph2D(): (container: HTMLElement) => Instance;
}

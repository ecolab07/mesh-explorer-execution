type GraphNode = { id?: string; label?: string };
type GraphData = { nodes?: GraphNode[]; links?: Array<{ source?: string; target?: string; type?: string }> };

type NodeClickHandler = (node: GraphNode, event?: MouseEvent) => void;

type Instance = {
  nodeId: (value: string) => Instance;
  nodeLabel: (value: unknown) => Instance;
  linkColor: (value: unknown) => Instance;
  graphData: (value: GraphData) => Instance;
  onNodeClick: (handler: NodeClickHandler) => Instance;
};

type UnderlyingWithNodeClick = {
  onNodeClick?: (handler: (node: GraphNode, event?: MouseEvent) => void) => unknown;
};

export default function ForceGraph2D(): (container: HTMLElement) => Instance {
  return (container: HTMLElement) => {
    const root = document.createElement("div");
    root.style.margin = "0";
    root.style.padding = "8px";
    root.style.height = "100%";
    root.style.overflow = "auto";
    root.style.background = "#f8fafc";

    const nodeList = document.createElement("div");
    nodeList.style.display = "flex";
    nodeList.style.gap = "6px";
    nodeList.style.flexWrap = "wrap";
    nodeList.style.marginBottom = "8px";

    const pre = document.createElement("pre");
    pre.style.margin = "0";

    root.replaceChildren(nodeList, pre);
    container.replaceChildren(root);

    let clickHandler: NodeClickHandler | null = null;

    const render = (value: GraphData): void => {
      const nodes = value.nodes ?? [];
      nodeList.replaceChildren(
        ...nodes.map((node) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = node.label ?? node.id ?? "(unlabeled)";
          button.dataset.nodeId = node.id;
          button.onclick = (event) => {
            clickHandler?.(node, event as MouseEvent);
          };
          return button;
        })
      );
      pre.textContent = `2D view (stub)\n${JSON.stringify(value, null, 2)}`;
    };

    const inst: UnderlyingWithNodeClick = {};
    const instance: Instance = {
      nodeId: () => instance,
      nodeLabel: () => instance,
      linkColor: () => instance,
      graphData: (value) => {
        render(value);
        return instance;
      },
      onNodeClick: (handler) => {
        clickHandler = handler;
        if (typeof inst.onNodeClick === "function") {
          inst.onNodeClick((node, event) => handler(node, event));
        }
        return instance;
      }
    };

    return instance;
  };
}

export type { GraphData, GraphNode, Instance };

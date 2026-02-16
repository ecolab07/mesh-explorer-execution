type GraphData = { nodes?: Array<{ id?: string; label?: string }>; links?: Array<{ source?: string; target?: string; type?: string }> };

type Instance = {
  nodeId: (value: string) => Instance;
  nodeLabel: (value: unknown) => Instance;
  linkColor: (value: unknown) => Instance;
  graphData: (value: GraphData) => Instance;
};

export default function ForceGraph2D(): (container: HTMLElement) => Instance {
  return (container: HTMLElement) => {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "8px";
    pre.style.height = "100%";
    pre.style.overflow = "auto";
    pre.style.background = "#f8fafc";
    container.replaceChildren(pre);

    const instance: Instance = {
      nodeId: () => instance,
      nodeLabel: () => instance,
      linkColor: () => instance,
      graphData: (value) => {
        pre.textContent = `2D view (stub)\n${JSON.stringify(value, null, 2)}`;
        return instance;
      }
    };
    return instance;
  };
}

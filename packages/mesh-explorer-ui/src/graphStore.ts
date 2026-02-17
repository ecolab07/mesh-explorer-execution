export type Cursor = { metaSeq: number; graphSeq: number };
export type GraphNode = { id: string; label: string; level?: number; metadata?: Record<string, unknown> };
export type GraphLink = { id: string; source: string; target: string; type: string; label?: string };

export type GraphEvent =
  | { type: "graph.node.created"; node: GraphNode }
  | { type: "graph.node.label.updated"; nodeId: string; label: string }
  | { type: "graph.node.deleted"; nodeId: string }
  | { type: "graph.link.created"; link: GraphLink }
  | { type: "graph.link.deleted"; linkId: string };

export type GraphState = {
  nodesById: Map<string, GraphNode>;
  linksById: Map<string, GraphLink>;
  selectedNodeIds: Set<string>;
  cursor: Cursor;
};

export type GraphStore = {
  getState: () => GraphState;
  subscribe: (listener: (state: GraphState) => void) => () => void;
  applyGraphEvents: (events: GraphEvent[]) => void;
  setCursor: (cursor: Cursor) => void;
  toggleSelectNode: (id: string) => void;
  replaceSelection: (ids: string[]) => void;
  clearSelection: () => void;
};

export function createGraphStore(): GraphStore {
  let state: GraphState = {
    nodesById: new Map(),
    linksById: new Map(),
    selectedNodeIds: new Set(),
    cursor: { metaSeq: 0, graphSeq: 0 }
  };
  const listeners = new Set<(value: GraphState) => void>();

  function emit(next: GraphState): void {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    applyGraphEvents(events) {
      if (events.length === 0) return;
      const nodesById = new Map(state.nodesById);
      const linksById = new Map(state.linksById);
      const selectedNodeIds = new Set(state.selectedNodeIds);

      for (const event of events) {
        if (event.type === "graph.node.created") {
          nodesById.set(event.node.id, event.node);
          continue;
        }
        if (event.type === "graph.node.label.updated") {
          const node = nodesById.get(event.nodeId);
          if (node) nodesById.set(event.nodeId, { ...node, label: event.label });
          continue;
        }
        if (event.type === "graph.node.deleted") {
          nodesById.delete(event.nodeId);
          selectedNodeIds.delete(event.nodeId);
          for (const [id, link] of linksById) {
            if (link.source === event.nodeId || link.target === event.nodeId) linksById.delete(id);
          }
          continue;
        }
        if (event.type === "graph.link.created") {
          linksById.set(event.link.id, event.link);
          continue;
        }
        if (event.type === "graph.link.deleted") {
          linksById.delete(event.linkId);
        }
      }

      emit({
        ...state,
        nodesById,
        linksById,
        selectedNodeIds
      });
    },
    setCursor(cursor) {
      emit({ ...state, cursor });
    },
    toggleSelectNode(id) {
      const next = new Set(state.selectedNodeIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      emit({ ...state, selectedNodeIds: next });
    },
    replaceSelection(ids) {
      emit({ ...state, selectedNodeIds: new Set(ids) });
    },
    clearSelection() {
      emit({ ...state, selectedNodeIds: new Set() });
    }
  };
}

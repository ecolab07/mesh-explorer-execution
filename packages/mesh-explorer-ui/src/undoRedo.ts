import type { GraphLink, GraphNode, GraphState } from "./graphStore.js";

type UndoKind = "rename" | "deleteLink" | "deleteNode" | "createNode" | "createLink" | "multiDelete";

type UndoItem = {
  kind: UndoKind;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

export type UndoRedoActions = {
  renameNode: (nodeId: string, label: string) => Promise<void>;
  deleteLink: (linkId: string) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  createNodeFromSnapshot: (node: GraphNode) => Promise<void>;
  createLinkFromSnapshot: (link: GraphLink) => Promise<void>;
};

export class UndoRedoManager {
  private undoStack: UndoItem[] = [];
  private redoStack: UndoItem[] = [];

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clearRedo(): void {
    this.redoStack = [];
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  debugStackSizes(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  async recordRename(nodeId: string, labelBefore: string, labelAfter: string, actions: UndoRedoActions): Promise<void> {
    await actions.renameNode(nodeId, labelAfter);
    this.push({
      kind: "rename",
      undo: async () => actions.renameNode(nodeId, labelBefore),
      redo: async () => actions.renameNode(nodeId, labelAfter)
    });
  }

  async recordDeleteLink(link: GraphLink, actions: UndoRedoActions): Promise<void> {
    await actions.deleteLink(link.id);
    this.push({
      kind: "deleteLink",
      undo: async () => actions.createLinkFromSnapshot(link),
      redo: async () => actions.deleteLink(link.id)
    });
  }

  async recordDeleteNode(node: GraphNode, incidentLinks: GraphLink[], actions: UndoRedoActions): Promise<void> {
    await actions.deleteNode(node.id);
    this.push({
      kind: "deleteNode",
      undo: async () => {
        await actions.createNodeFromSnapshot(node);
        for (const link of incidentLinks) {
          await actions.createLinkFromSnapshot(link);
        }
      },
      redo: async () => actions.deleteNode(node.id)
    });
  }

  async recordCreateNode(node: GraphNode, actions: UndoRedoActions): Promise<void> {
    await actions.createNodeFromSnapshot(node);
    this.push({
      kind: "createNode",
      undo: async () => actions.deleteNode(node.id),
      redo: async () => actions.createNodeFromSnapshot(node)
    });
  }

  async recordCreateLink(link: GraphLink, actions: UndoRedoActions): Promise<void> {
    await actions.createLinkFromSnapshot(link);
    this.push({
      kind: "createLink",
      undo: async () => actions.deleteLink(link.id),
      redo: async () => actions.createLinkFromSnapshot(link)
    });
  }

  async recordMultiDelete(nodes: GraphNode[], links: GraphLink[], actions: UndoRedoActions): Promise<void> {
    const stableNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
    const stableLinks = [...links].sort((left, right) => left.id.localeCompare(right.id));
    const nodeIds = new Set(stableNodes.map((node) => node.id));
    const explicitLinks = stableLinks.filter((link) => !nodeIds.has(link.source) && !nodeIds.has(link.target));

    for (const node of stableNodes) {
      await actions.deleteNode(node.id);
    }
    for (const link of explicitLinks) {
      await actions.deleteLink(link.id);
    }

    this.push({
      kind: "multiDelete",
      undo: async () => {
        for (const node of stableNodes) {
          await actions.createNodeFromSnapshot(node);
        }
        for (const link of stableLinks) {
          await actions.createLinkFromSnapshot(link);
        }
      },
      redo: async () => {
        for (const node of stableNodes) {
          await actions.deleteNode(node.id);
        }
        for (const link of explicitLinks) {
          await actions.deleteLink(link.id);
        }
      }
    });
  }

  async undo(): Promise<void> {
    const item = this.undoStack.at(-1);
    if (!item) return;
    await item.undo();
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack.push(item);
  }

  async redo(): Promise<void> {
    const item = this.redoStack.at(-1);
    if (!item) return;
    await item.redo();
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack.push(item);
  }

  private push(item: UndoItem): void {
    this.undoStack.push(item);
    this.redoStack = [];
  }
}

export function getIncidentLinks(state: GraphState, nodeId: string): GraphLink[] {
  return Array.from(state.linksById.values()).filter((link) => link.source === nodeId || link.target === nodeId);
}

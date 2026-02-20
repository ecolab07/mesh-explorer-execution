import { describe, expect, it, vi } from "vitest";
import { UndoRedoManager } from "../src/undoRedo.js";

const makeActions = () => ({
  renameNode: vi.fn(async () => undefined),
  deleteLink: vi.fn(async () => undefined),
  deleteNode: vi.fn(async () => undefined),
  createNodeFromSnapshot: vi.fn(async () => undefined),
  createLinkFromSnapshot: vi.fn(async () => undefined)
});

describe("undo redo manager", () => {
  it("supports rename undo/redo", async () => {
    const manager = new UndoRedoManager();
    const actions = makeActions();

    await manager.recordRename("n1", "before", "after", actions);
    await manager.undo();
    await manager.redo();

    expect(actions.renameNode).toHaveBeenNthCalledWith(1, "n1", "after");
    expect(actions.renameNode).toHaveBeenNthCalledWith(2, "n1", "before");
    expect(actions.renameNode).toHaveBeenNthCalledWith(3, "n1", "after");
  });

  it("supports delete link undo/redo", async () => {
    const manager = new UndoRedoManager();
    const actions = makeActions();
    const link = { id: "l1", source: "a", target: "b", type: "related" };

    await manager.recordDeleteLink(link, actions);
    await manager.undo();
    await manager.redo();

    expect(actions.deleteLink).toHaveBeenNthCalledWith(1, "l1");
    expect(actions.createLinkFromSnapshot).toHaveBeenNthCalledWith(1, link);
    expect(actions.deleteLink).toHaveBeenNthCalledWith(2, "l1");
  });

  it("supports delete node undo/redo with incident links", async () => {
    const manager = new UndoRedoManager();
    const actions = makeActions();
    const node = { id: "a", label: "A" };
    const links = [{ id: "l2", source: "a", target: "b", type: "related" }];

    await manager.recordDeleteNode(node, links, actions);
    await manager.undo();
    await manager.redo();

    expect(actions.deleteNode).toHaveBeenNthCalledWith(1, "a");
    expect(actions.createNodeFromSnapshot).toHaveBeenNthCalledWith(1, node);
    expect(actions.createLinkFromSnapshot).toHaveBeenNthCalledWith(1, links[0]);
    expect(actions.deleteNode).toHaveBeenNthCalledWith(2, "a");
  });

  it("resets undo/redo stacks", async () => {
    const manager = new UndoRedoManager();
    const actions = makeActions();

    await manager.recordRename("n1", "before", "after", actions);
    await manager.undo();
    manager.reset();

    expect(manager.debugStackSizes()).toEqual({ undo: 0, redo: 0 });
  });
});

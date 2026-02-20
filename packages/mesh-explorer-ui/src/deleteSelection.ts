import type { GraphState } from "./graphStore.js";

export type MultiDeletePlan = {
  nodeIds: string[];
  linkIds: string[];
};

export function buildMultiDeletePlan(state: Pick<GraphState, "selectedNodeIds" | "linksById">, selectedLinkIds: Set<string>): MultiDeletePlan {
  const nodeIds = Array.from(state.selectedNodeIds).sort((left, right) => left.localeCompare(right));
  const selectedLinksStable = Array.from(selectedLinkIds).sort((left, right) => left.localeCompare(right));
  if (nodeIds.length === 0) {
    return { nodeIds: [], linkIds: selectedLinksStable };
  }

  const selectedNodeSet = new Set(nodeIds);
  const linkIds = selectedLinksStable.filter((linkId) => {
    const link = state.linksById.get(linkId);
    if (!link) return false;
    return !selectedNodeSet.has(link.source) && !selectedNodeSet.has(link.target);
  });

  return { nodeIds, linkIds };
}

import type { GraphLink, GraphNode, GraphState } from "../graphStore.js";

export type ExportedGraphNode = {
  id: string;
  label: string;
  level?: number;
  metadata?: Record<string, unknown>;
};

export type ExportedGraphLink = {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
};

export type ExportedGraphV1 = {
  version: 1;
  nodes: ExportedGraphNode[];
  links: ExportedGraphLink[];
};

export function exportGraphFromState(state: Pick<GraphState, "nodesById" | "linksById">): ExportedGraphV1 {
  const nodes: ExportedGraphNode[] = Array.from(state.nodesById.values()).map((node: GraphNode) => ({
    id: node.id,
    label: node.label,
    level: node.level,
    metadata: node.metadata
  }));

  const links: ExportedGraphLink[] = Array.from(state.linksById.values())
    .filter((link: GraphLink) => state.nodesById.has(link.source) && state.nodesById.has(link.target))
    .map((link: GraphLink) => ({
      id: link.id,
      source: link.source,
      target: link.target,
      type: link.type,
      label: link.label
    }));

  return { version: 1, nodes, links };
}

export function parseExportedGraph(raw: unknown): ExportedGraphV1 {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.links)) {
    throw new Error("Invalid graph export payload: expected { version: 1, nodes: [], links: [] }");
  }

  const nodes = raw.nodes.map((node, index) => parseNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = raw.links.map((link, index) => parseLink(link, index, nodeIds));
  return { version: 1, nodes, links };
}

function parseNode(raw: unknown, index: number): ExportedGraphNode {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.label !== "string") {
    throw new Error(`Invalid node at index ${index}`);
  }
  if (raw.level !== undefined && typeof raw.level !== "number") {
    throw new Error(`Invalid node.level at index ${index}`);
  }
  if (raw.metadata !== undefined && !isRecord(raw.metadata)) {
    throw new Error(`Invalid node.metadata at index ${index}`);
  }
  return {
    id: raw.id,
    label: raw.label,
    level: raw.level,
    metadata: raw.metadata as Record<string, unknown> | undefined
  };
}

function parseLink(raw: unknown, index: number, nodeIds: Set<string>): ExportedGraphLink {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.source !== "string" || typeof raw.target !== "string" || typeof raw.type !== "string") {
    throw new Error(`Invalid link at index ${index}`);
  }
  if (raw.label !== undefined && typeof raw.label !== "string") {
    throw new Error(`Invalid link.label at index ${index}`);
  }
  if (!nodeIds.has(raw.source) || !nodeIds.has(raw.target)) {
    throw new Error(`Link at index ${index} references unknown node`);
  }
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    type: raw.type,
    label: raw.label
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

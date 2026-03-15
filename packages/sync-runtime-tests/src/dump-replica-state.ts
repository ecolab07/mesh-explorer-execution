import type { ReplicaHarness } from "./harness.js";

export type SerializedGraphState = string;

type NormalizedValue = null | boolean | number | string | NormalizedValue[] | { [key: string]: NormalizedValue };

interface NormalizedGraphState {
  metadata: {
    cursor: number;
    nodeCount: number;
    edgeCount: number;
  };
  nodes: Array<{ id: string; [key: string]: NormalizedValue }>;
  edges: Array<{ id: string; [key: string]: NormalizedValue }>;
}

export function dumpReplicaState(replica: ReplicaHarness): SerializedGraphState {
  const rawNodes = replica.handle.getState().map((node) => normalizeValue(node)) as Array<{ id: string; [key: string]: NormalizedValue }>;
  const nodes = sortByStableId(rawNodes);

  const edges: Array<{ id: string; [key: string]: NormalizedValue }> = [];

  const normalized: NormalizedGraphState = {
    metadata: {
      cursor: replica.handle.getCursor(),
      nodeCount: nodes.length,
      edgeCount: edges.length
    },
    nodes,
    edges
  };

  return JSON.stringify(normalizeValue(normalized));
}

function normalizeValue(value: unknown): NormalizedValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeValue(entry));
    const sortable = normalized.every((entry) => isRecord(entry) && typeof entry.id === "string");
    if (sortable) {
      return sortByStableId(normalized as Array<{ id: string; [key: string]: NormalizedValue }>);
    }
    return normalized;
  }

  if (isRecord(value)) {
    const result: { [key: string]: NormalizedValue } = {};
    const keys = Object.keys(value)
      .filter((key) => !isTimestampField(key))
      .sort((left, right) => left.localeCompare(right));

    for (const key of keys) {
      result[key] = normalizeValue(value[key]);
    }

    return result;
  }

  return String(value);
}

function sortByStableId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}

function isTimestampField(fieldName: string): boolean {
  return fieldName === "createdAt" || fieldName === "updatedAt" || fieldName === "ts" || fieldName.endsWith("At");
}

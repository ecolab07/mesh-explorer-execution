import type { Cursor, GraphLink, GraphNode, GraphStore } from "./graphStore.js";

export const BOOTSTRAP_CACHE_SCHEMA_VERSION = 1;
export const BOOTSTRAP_SNAPSHOT_VERSION = 1;
export const BOOTSTRAP_PROJECTION_VERSION = 1;

export type BootstrapProjection = {
  version: 1;
  nodes: GraphNode[];
  links: GraphLink[];
};

export type BootstrapCacheRecord = {
  schemaVersion: number;
  snapshotVersion?: number;
  projectionVersion?: number;
  graphSpaceId?: string;
  principal?: string;
  cursor: Cursor;
  stateDigest: string;
  projection: BootstrapProjection;
};

export type BootstrapPersistenceResult = {
  committed: boolean;
  phase: "committed" | "cache-write-failed" | "cursor-write-failed";
};

export function createProjectionSnapshot(store: GraphStore): BootstrapProjection {
  const state = store.getState();
  return {
    version: 1,
    nodes: Array.from(state.nodesById.values()).map((node) => ({ ...node })),
    links: Array.from(state.linksById.values()).map((link) => ({ ...link }))
  };
}

export function hydrateStoreFromProjection(store: GraphStore, projection: BootstrapProjection): void {
  store.resetProjection();
  store.applyGraphEvents(projection.nodes.map((node) => ({ type: "graph.node.created", node } as const)));
  store.applyGraphEvents(projection.links.map((link) => ({ type: "graph.link.created", link } as const)));
}

export function computeStateDigest(projection: BootstrapProjection): string {
  const canonicalProjection = {
    version: projection.version,
    nodes: projection.nodes
      .map((node) => canonicalizeRecord(node))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    links: projection.links
      .map((link) => canonicalizeRecord(link))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  };
  return fnv1a64Hex(stableStringify(canonicalProjection));
}

export function makeBootstrapCacheRecord(
  cursor: Cursor,
  projection: BootstrapProjection,
  metadata?: { graphSpaceId: string; principal: string }
): BootstrapCacheRecord {
  return {
    schemaVersion: BOOTSTRAP_CACHE_SCHEMA_VERSION,
    snapshotVersion: BOOTSTRAP_SNAPSHOT_VERSION,
    projectionVersion: BOOTSTRAP_PROJECTION_VERSION,
    graphSpaceId: metadata?.graphSpaceId,
    principal: metadata?.principal,
    cursor,
    stateDigest: computeStateDigest(projection),
    projection
  };
}

export function persistBootstrapCacheRecord(
  storageKey: string,
  cursorStorageKey: string,
  record: BootstrapCacheRecord,
  write: (key: string, value: string) => void,
  remove: (key: string) => void
): BootstrapPersistenceResult {
  // Finalization contract: restart may trust persisted bootstrap artifacts only when
  // both cache projection and cursor marker are durably written as one logical unit.
  // If cursor write fails after cache write, cache is removed best-effort so ambiguous
  // partial persistence resolves to conservative replay on restart.
  try {
    write(storageKey, JSON.stringify(record));
  } catch {
    return { committed: false, phase: "cache-write-failed" };
  }

  try {
    write(cursorStorageKey, JSON.stringify(record.cursor));
    return { committed: true, phase: "committed" };
  } catch {
    try {
      remove(storageKey);
    } catch {
      // best effort cleanup to keep ambiguous durable state conservative.
    }
    return { committed: false, phase: "cursor-write-failed" };
  }
}

export function readBootstrapCacheRecord(storageKey: string, read: (key: string) => string | null): BootstrapCacheRecord | null {
  try {
    const raw = read(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootstrapCacheRecord;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.schemaVersion !== "number") return null;
    if (!("snapshotVersion" in parsed) || (parsed.snapshotVersion !== undefined && typeof parsed.snapshotVersion !== "number")) {
      parsed.snapshotVersion = undefined;
    }
    if (!("projectionVersion" in parsed) || (parsed.projectionVersion !== undefined && typeof parsed.projectionVersion !== "number")) {
      parsed.projectionVersion = undefined;
    }
    if (!("graphSpaceId" in parsed) || (parsed.graphSpaceId !== undefined && typeof parsed.graphSpaceId !== "string")) {
      parsed.graphSpaceId = undefined;
    }
    if (!("principal" in parsed) || (parsed.principal !== undefined && typeof parsed.principal !== "string")) {
      parsed.principal = undefined;
    }
    if (!isCursor(parsed.cursor)) return null;
    if (typeof parsed.stateDigest !== "string" || parsed.stateDigest.trim().length === 0) return null;
    if (!parsed.projection || parsed.projection.version !== 1) return null;
    if (!Array.isArray(parsed.projection.nodes) || !Array.isArray(parsed.projection.links)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearBootstrapCacheRecord(storageKey: string, remove: (key: string) => void): void {
  try {
    remove(storageKey);
  } catch {
    // ignore storage errors
  }
}

function isCursor(value: unknown): value is Cursor {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<Cursor>;
  return typeof maybe.metaSeq === "number" && typeof maybe.graphSeq === "number";
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (valueType === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(null);
}

function canonicalizeRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(stableStringify(value)) as T;
}

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

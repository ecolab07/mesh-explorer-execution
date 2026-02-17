import type { Cursor } from "./graphStore.js";

export function buildSyncPollUrl(baseUrl: string, graphSpaceId: string, cursor: Cursor, limits: { graph: number; meta: number }): string {
  const encodedCursor = encodeURIComponent(JSON.stringify(cursor));
  const encodedLimits = encodeURIComponent(JSON.stringify(limits));
  return `${baseUrl}/v1/${encodeURIComponent(graphSpaceId)}/sync:poll?cursor=${encodedCursor}&limits=${encodedLimits}`;
}

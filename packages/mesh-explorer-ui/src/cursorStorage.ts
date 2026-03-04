export function cursorStorageKey(principal: string, graphSpaceId: string): string {
  return `mesh.cursor.${principal}.${graphSpaceId}`;
}

export function bootstrapCacheStorageKey(principal: string, graphSpaceId: string): string {
  return `mesh.bootstrapCache.${principal}.${graphSpaceId}`;
}

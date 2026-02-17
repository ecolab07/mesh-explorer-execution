export function cursorStorageKey(principal: string, graphSpaceId: string): string {
  return `mesh.cursor.${principal}.${graphSpaceId}`;
}

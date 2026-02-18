export const SUBSCRIBE_RETRY_DELAY_MS = 1000;
export const SUBSCRIBE_ERROR_LOG_THROTTLE_MS = 5000;

export function isSyncDebugEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
  if (env?.MESH_DEBUG_SYNC === "1") return true;
  const processEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return processEnv?.MESH_DEBUG_SYNC === "1";
}

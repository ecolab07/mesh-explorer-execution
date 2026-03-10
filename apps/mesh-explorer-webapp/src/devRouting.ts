export type DevRoutingMode = "development" | "proxy";

export type DevRoutingDefaults = {
  apiBaseUrl: string;
  subscribeBaseUrl: string;
};

export const DEVELOPMENT_ROUTING_DEFAULTS: DevRoutingDefaults = {
  apiBaseUrl: "http://127.0.0.1:8090",
  subscribeBaseUrl: "http://127.0.0.1:8090"
};

export const PROXY_ROUTING_DEFAULTS: DevRoutingDefaults = {
  apiBaseUrl: "http://127.0.0.1:8090",
  subscribeBaseUrl: "http://127.0.0.1:8091"
};

export function resolveDevRoutingConfig(mode: string, env: Record<string, string | undefined>): DevRoutingDefaults {
  const defaults = mode === "proxy" ? PROXY_ROUTING_DEFAULTS : DEVELOPMENT_ROUTING_DEFAULTS;
  return {
    apiBaseUrl: env.MESH_API_BASE_URL || defaults.apiBaseUrl,
    subscribeBaseUrl: env.MESH_SUBSCRIBE_BASE_URL || defaults.subscribeBaseUrl
  };
}

export function resolveRoutingDiagnostic(env: Record<string, unknown>): { mode: string; apiBaseUrl: string; subscribeBaseUrl: string } {
  return {
    mode: String(env.MODE ?? "development"),
    apiBaseUrl: String(env.MESH_API_BASE_URL ?? DEVELOPMENT_ROUTING_DEFAULTS.apiBaseUrl),
    subscribeBaseUrl: String(env.MESH_SUBSCRIBE_BASE_URL ?? DEVELOPMENT_ROUTING_DEFAULTS.subscribeBaseUrl)
  };
}

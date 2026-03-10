import { defineConfig, loadEnv } from "vite";

import { resolveDevRoutingConfig, resolveModeScopedRoutingEnv } from "./src/devRouting";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MESH_");
  const routingEnv = resolveModeScopedRoutingEnv(mode, env);
  const isProxyMode = mode === "proxy";
  const { apiBaseUrl, subscribeBaseUrl } = resolveDevRoutingConfig(mode, routingEnv);

  return {
    envPrefix: ["VITE_", "MESH_"],
    server: {
      host: "127.0.0.1",
      port: isProxyMode ? 5174 : 5173,
      strictPort: true
    },
    define: {
      "import.meta.env.MESH_API_BASE_URL": JSON.stringify(apiBaseUrl),
      "import.meta.env.MESH_SUBSCRIBE_BASE_URL": JSON.stringify(subscribeBaseUrl)
    }
  };
});

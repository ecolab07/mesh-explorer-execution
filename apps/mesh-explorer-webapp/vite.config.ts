import { defineConfig, loadEnv } from "vite";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8090";
const DEFAULT_SUBSCRIBE_BASE_URL = "http://127.0.0.1:8090";
const PROXY_SUBSCRIBE_BASE_URL = "http://127.0.0.1:8091";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MESH_");
  const isProxyMode = mode === "proxy";
  const apiBaseUrl = env.MESH_API_BASE_URL || DEFAULT_API_BASE_URL;
  const subscribeBaseUrl = env.MESH_SUBSCRIBE_BASE_URL || (isProxyMode ? PROXY_SUBSCRIBE_BASE_URL : DEFAULT_SUBSCRIBE_BASE_URL);

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

import { mountMeshExplorerUi } from "@mesh/mesh-explorer-ui";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");

if (import.meta.env.DEV) {
  console.info("[mesh-explorer-webapp] dev routing", {
    mode: import.meta.env.MODE,
    apiBaseUrl: import.meta.env.MESH_API_BASE_URL,
    subscribeBaseUrl: import.meta.env.MESH_SUBSCRIBE_BASE_URL
  });
}

mountMeshExplorerUi(root as HTMLElement);

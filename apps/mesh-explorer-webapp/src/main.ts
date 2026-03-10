import { resolveRoutingDiagnostic } from "./devRouting";
import { mountMeshExplorerUi } from "@mesh/mesh-explorer-ui";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");

if (import.meta.env.DEV) {
  console.info("[mesh-explorer-webapp] dev routing", resolveRoutingDiagnostic(import.meta.env));
}

mountMeshExplorerUi(root as HTMLElement);

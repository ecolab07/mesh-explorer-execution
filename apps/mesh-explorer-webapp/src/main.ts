import { mountMeshExplorerUi } from "@mesh/mesh-explorer-ui";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");
mountMeshExplorerUi(root as HTMLElement);

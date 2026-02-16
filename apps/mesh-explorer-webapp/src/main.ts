import { mountMeshExplorerUi } from "../../../packages/mesh-explorer-ui/src/index";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");
mountMeshExplorerUi(root as HTMLElement);

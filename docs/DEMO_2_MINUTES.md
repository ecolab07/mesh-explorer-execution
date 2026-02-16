# Demo 2 minutes

0. Install workspace dependencies once (from repo root):
   - `pnpm install`
1. Start graph server:
   - `pnpm -r --filter @mesh/graph-server... build`
   - `pnpm --dir apps/mesh-graph-server start`
2. Start webapp:
   - `pnpm --dir apps/mesh-explorer-webapp dev`
3. In UI, click **Connect**.
4. Click **Add node** and create at least 2 nodes.
5. Click **Add link** and create a typed link between node IDs.
6. Restart server using same storage dir (`MESH_GRAPH_STORAGE_DIR=...`) and reload webapp; graph recovers to same `{nodes, links}`.

Windows note: if Vite fails with `Cannot find module '@rollup/rollup-win32-x64-msvc'`, run `pnpm repair:win-rollup` from the repo root.

# Demo 2 minutes

1. Start graph server:
   - `pnpm --dir apps/mesh-graph-server install`
   - `pnpm --dir apps/mesh-graph-server build`
   - `pnpm --dir apps/mesh-graph-server start`
2. Start webapp:
   - `pnpm --dir apps/mesh-explorer-webapp install`
   - `pnpm --dir apps/mesh-explorer-webapp dev`
3. In UI, click **Connect**.
4. Click **Add node** and create at least 2 nodes.
5. Click **Add link** and create a typed link between node IDs.
6. Restart server using same storage dir (`MESH_GRAPH_STORAGE_DIR=...`) and reload webapp; graph recovers to same `{nodes, links}`.

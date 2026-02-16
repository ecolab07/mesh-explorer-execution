# Run Local Mesh Graph Server

## Start server
From repository root:

```bash
pnpm --dir apps/mesh-graph-server install
pnpm --dir apps/mesh-graph-server build
pnpm --dir apps/mesh-graph-server start
```

Defaults:
- host: `127.0.0.1`
- port: `8090` (`PORT` env overrides)
- graphSpaceId: `mesh-explorer-graph-v1`

## Submit + pull (curl)

```bash
curl -sS -X POST 'http://127.0.0.1:8090/v1/mesh-explorer-graph-v1/commands:submit' \
  -H 'content-type: application/json' \
  -H 'x-mesh-principal: alice' \
  -d '{"graphSpaceId":"mesh-explorer-graph-v1","commandId":"cmd-1","actorId":"alice","idempotencyKey":"idem-1","payload":{"type":"graph.node.created","node":{"id":"n1","label":"Node 1"}}}'

curl -sS 'http://127.0.0.1:8090/v1/mesh-explorer-graph-v1/sync:pull?from=0&limitTx=32' \
  -H 'x-mesh-principal: alice'
```

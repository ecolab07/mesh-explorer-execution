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

All graph-server requests require `x-mesh-principal`. If the header is missing (or blank), the server returns:

```json
{"status":"rejected","category":"PERMISSION","reasonCode":"AUTH.PRINCIPAL_REQUIRED"}
```

`@mesh/mesh-explorer-ui` now auto-populates a local default principal (`local-dev`) and sends it on every request; you can override it in the principal field (persisted in localStorage) or with `?principal=<id>` in the URL.

## Submit + pull (curl)

```bash
curl -sS -X POST 'http://127.0.0.1:8090/v1/mesh-explorer-graph-v1/commands:submit' \
  -H 'content-type: application/json' \
  -H 'x-mesh-principal: alice' \
  -d '{"graphSpaceId":"mesh-explorer-graph-v1","commandId":"cmd-1","actorId":"alice","idempotencyKey":"idem-1","payload":{"type":"graph.node.created","node":{"id":"n1","label":"Node 1"}}}'

curl -sS 'http://127.0.0.1:8090/v1/mesh-explorer-graph-v1/sync:pull?from=0&limitTx=32' \
  -H 'x-mesh-principal: alice'
```

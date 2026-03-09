# Mesh Transport Proxy — Quick How-To

## Purpose
Local dev/test proxy for deterministic `sync:subscribe` transport failures (`pass`, `fail`, `hang`, `close`) without changing canonical backend logic.

## Start services
```bash
pnpm graph-server
pnpm dev:transport-proxy
pnpm dev:web
pnpm dev:web:proxy
```

Defaults:
- Backend: `http://127.0.0.1:8090`
- Proxy: `http://127.0.0.1:8091` (upstream `:8090`)
- Web app normal dev: `http://127.0.0.1:5173`
- Web app proxy dev: `http://127.0.0.1:5174`

Optional proxy env:
```bash
MESH_TRANSPORT_PROXY_HOST=127.0.0.1 \
MESH_TRANSPORT_PROXY_PORT=8091 \
MESH_TRANSPORT_PROXY_UPSTREAM=http://127.0.0.1:8090 \
MESH_TRANSPORT_PROXY_CLOSE_DELAY_MS=200 \
pnpm dev:transport-proxy
```

## Two-tab workflow
- Tab A: `http://127.0.0.1:5173` (API/poll/subscribe direct to `:8090`)
- Tab B: `http://127.0.0.1:5174` (API/poll direct to `:8090`, subscribe via proxy `:8091`)

## Check current mode
```bash
curl http://127.0.0.1:8091/__test/transport/state
```

## Change fault mode
```bash
curl -X POST http://127.0.0.1:8091/__test/transport/mode \
  -H 'content-type: application/json' \
  -d '{"subscribeMode":"hang"}'
```

Modes:
- `pass`
- `fail`
- `hang`
- `close`

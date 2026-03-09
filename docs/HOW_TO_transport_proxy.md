# Mesh Transport Proxy — Quick How-To

## Purpose
Local dev/test proxy for deterministic `sync:subscribe` transport failures (`pass`, `fail`, `hang`, `close`) without changing canonical backend logic.

## Start
```bash
pnpm dev:transport-proxy
```

Defaults:
- Proxy: `http://127.0.0.1:8091`
- Upstream: `http://127.0.0.1:8090`

Optional env:
```bash
MESH_TRANSPORT_PROXY_HOST=127.0.0.1 \
MESH_TRANSPORT_PROXY_PORT=8091 \
MESH_TRANSPORT_PROXY_UPSTREAM=http://127.0.0.1:8090 \
MESH_TRANSPORT_PROXY_CLOSE_DELAY_MS=200 \
pnpm dev:transport-proxy
```

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

## Two-tab test
- Tab A: backend direct (`http://127.0.0.1:8090`)
- Tab B: backend through proxy (`http://127.0.0.1:8091`)

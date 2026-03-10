# Mesh Transport Proxy — Quick How-To

## Purpose
Local dev/test proxy for deterministic `sync:subscribe` transport failures (`pass`, `fail`, `hang`, `close`) without changing canonical backend logic.

## Start services
One-command lab startup:
```bash
pnpm dev:lab
```

Or run each process separately:
```bash
pnpm graph-server
pnpm dev:transport-proxy
pnpm dev:web
pnpm dev:web:proxy
```

Defaults:
- Backend: `http://127.0.0.1:8090`
- Proxy: `http://127.0.0.1:8091` (upstream `:8090`)
- Web app normal dev (`vite --mode development`): `http://127.0.0.1:5173`
- Web app proxy dev (`vite --mode proxy`): `http://127.0.0.1:5174`

Webapp mode/env mapping (`apps/mesh-explorer-webapp/vite.config.ts`):
- `development` mode defaults: `MESH_API_BASE_URL=http://127.0.0.1:8090`, `MESH_SUBSCRIBE_BASE_URL=http://127.0.0.1:8090`
- `proxy` mode defaults: `MESH_API_BASE_URL=http://127.0.0.1:8090`, `MESH_SUBSCRIBE_BASE_URL=http://127.0.0.1:8091`
- Optional overrides: `MESH_API_BASE_URL` and `MESH_SUBSCRIBE_BASE_URL` environment variables

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

## Dev routing visibility signal
In dev mode, the web app prints startup routing config in browser console:
- `[mesh-explorer-webapp] dev routing`
- Includes `mode`, `apiBaseUrl`, and `subscribeBaseUrl`

Use this to confirm whether a tab is normal or proxy-backed.

## Browser control UI (dev/test only)
Open:
- `http://127.0.0.1:8091/__test/transport/ui`

From this page you can:
- read current `subscribeMode`
- switch mode (`pass`/`fail`/`hang`/`close`) without `curl`

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

Runtime behavior note:
- Switching to `hang`, `fail`, or `close` immediately terminates any active `sync:subscribe` stream, so the new mode is visible right away on reconnect/new subscribe.
- You no longer need a manual `close` pre-step before toggling between `pass` / `hang` / `fail`.

## Invariant

Normal dev entry must never route subscribe through proxy.
5173 -> 8090
5174 -> 8091
# Mesh Transport Proxy (dev/test only)

Standalone local proxy that forwards traffic to canonical backend while allowing runtime fault injection for `GET /v1/{graphSpaceId}/sync:subscribe`.

- Default host/port: `127.0.0.1:8091`
- Default upstream: `http://127.0.0.1:8090`
- Control endpoints:
  - `GET /__test/transport/state`
  - `POST /__test/transport/mode`

Fault modes:
- `pass`: transparent proxy
- `fail`: deterministic `503` JSON failure for subscribe
- `hang`: keep subscribe request open without upstream stream
- `close`: proxy subscribe, then close stream after `MESH_TRANSPORT_PROXY_CLOSE_DELAY_MS` (default `200`)

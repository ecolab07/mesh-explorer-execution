# Integration Contract v1 (Mesh Sync HTTP)

This document is the **stable integration contract** for app/UI clients against Mesh v1 transport.

## Base endpoints
For a selected `graphSpaceId`, the transport surface is:

- `POST /v1/:graphSpaceId/commands:submit`
- `GET /v1/:graphSpaceId/sync:pull`
- `GET /v1/:graphSpaceId/sync:subscribe` (SSE)
- `GET /v1/:graphSpaceId/events:read`
- `GET /v1/:graphSpaceId/sync:poll`

Every request must include header: `x-mesh-principal: <principalId>`.

## Stable payloads
- **Command**: includes `graphSpaceId`, `commandId`, `actorId`, `idempotencyKey`, `payload`.
- **TransactionReceipt** (`status: "ok"`): successful canonical outcome.
- **CommandError** (`status: "rejected" | "error"`): mask-safe reason, no side-channel leakage.
- **Cursors**:
  - `sync:pull` uses visible graph cursor (`from`/`cursorAfterVisible`).
  - `sync:poll` uses `{ metaSeq, graphSeq }` cursor and returns `cursorAfter`.

## Delivery and consistency rules
- `commands:submit` acknowledgment is not commit guarantee: **ack != commit**.
- `sync:subscribe` is **best-effort acceleration** only.
- `sync:poll` is the **source of truth**.
- Resume logic must be cursor-based and replay-safe.
- Duplicate deliveries are valid; clients must be convergence/idempotency-safe.
- Visibility is principal-filtered; absent and masked are intentionally indistinguishable.

## Error model (mask-safe)
Errors expose reason codes by category (`VALIDATION`, `PERMISSION`, `TRANSPORT`, etc.) while preserving masking guarantees. Clients must branch on category/reason class, not on hidden object existence.

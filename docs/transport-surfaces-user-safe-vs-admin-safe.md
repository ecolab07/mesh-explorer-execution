# Transport surfaces: user-safe vs admin-safe (Sync/Transport v1)

## User-safe surfaces (principal scoped)

`LocalSyncGateway` exposes only principal-filtered transport primitives:

- `submit(graphSpaceId, principal, command, idempotencyKey?)`
  - `ackTransport` is transport-level acceptance only (never commit proof).
  - `final` resolves to canonical `TransactionReceipt` or `CommandError`.
- `syncPull(graphSpaceId, principal, fromCursorVisible, limits)`
  - returns only visible `TxBundle` units (tx-closed).
  - returns only a principal-visible cursor (`cursorAfterVisible`).
- `syncSubscribe(graphSpaceId, principal, fromCursorVisible)`
  - emits `txBundles` / `cursor` / optional `heartbeat` frames.
  - duplicates are allowed by contract; clients must deduplicate by tx id / cursor.

## Admin-safe surfaces (not exposed to principals)

These remain internal and are not surfaced by transport user APIs:

- global unfiltered event-store head/cursors,
- unfiltered tx index and hidden transaction counts,
- any admin-only diagnostics that could reveal masked entities.

## Security posture implemented in Pass 2

- **No global head leak:** transport cursor is principal-visible only.
- **Mask indistinguishability:** absent vs masked stays structurally indistinguishable in pull/subscribe outputs.
- **Tx-closed granularity:** transport unit remains full transaction bundles (no partial tx pages).
- **Retry safety:** idempotency key remains stable across retries; transport ack is never treated as commit.
- **Crash/reconnect safety:** durable state is server EventStore + client cursor; reconnect resumes from cursor.

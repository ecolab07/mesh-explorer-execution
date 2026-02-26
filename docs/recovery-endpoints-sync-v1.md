# Recovery endpoints (Sync/Transport v1)

`sync:subscribe` (SSE) is **best-effort** and must be treated as a latency optimization.
`sync:poll` is the **source of truth** for recovery.

## Endpoints

- `GET /v1/:graphSpaceId/events:read`
  - Query: `stream=meta|graph`, `fromSeqExclusive`, `limit` (events), `limitBytes`.
  - Returns visible `EventEnvelope[]` in monotonically increasing `seq` order.

- `GET /v1/:graphSpaceId/sync:poll`
  - Query: `cursor={metaSeq,graphSeq}`, `limits={meta,graph,metaBytes,graphBytes}`.
  - Returns `{ meta, graph, cursorAfter }`.

## Poll vs Subscribe

- `sync:poll` is the authoritative recovery path and must return backlog from the provided event cursor `{metaSeq,graphSeq}`.
- `sync:subscribe` is best-effort low-latency acceleration and may replay visible tx bundles from `from` (principal-visible tx cursor), but replay completeness is not guaranteed.
- Cursor families are different by design:
  - `sync:poll` / `events:read`: event-sequence cursors (`metaSeq`, `graphSeq`).
  - `sync:subscribe` / `sync:pull`: principal-visible transaction cursor (`from`, `cursorVisible`).
- Always keep a durable local event cursor (`metaSeq`, `graphSeq`) for recovery and call `sync:poll` on reconnect, uncertainty, duplicate ambiguity, or cursor mismatch.
- Client bootstrap rule: initial `chosenCursor` must be bounded by `minReadableCursor` when provided by `GET /v1/:graphSpaceId`; never start poll/subscribe below that floor, even when reusing a snapshot cursor.

## Gap / mismatch handling

- **Gap detection** (missing expected `seq` in stream): call `events:read` from last confirmed `seq` and merge idempotently.
- **Cursor mismatch** (`cursorBefore` differs from local cursor): stop trusting stream progression and call `sync:poll`.

## Security & non-leak guarantees

- All recovery reads are principal-scoped (`x-mesh-principal`).
- Responses are tx-closed: never partial transaction visibility.
- Masked transactions are indistinguishable from absent transactions on user-safe surfaces.
- `cursorAfter` advances only from actually returned visible events.

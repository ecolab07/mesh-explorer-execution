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

- Use `sync:subscribe` for low-latency deltas.
- Always keep a durable local cursor (`metaSeq`, `graphSeq`).
- On reconnect, uncertainty, duplicate ambiguity, or cursor mismatch, run `sync:poll` from the durable cursor.

## Gap / mismatch handling

- **Gap detection** (missing expected `seq` in stream): call `events:read` from last confirmed `seq` and merge idempotently.
- **Cursor mismatch** (`cursorBefore` differs from local cursor): stop trusting stream progression and call `sync:poll`.

## Security & non-leak guarantees

- All recovery reads are principal-scoped (`x-mesh-principal`).
- Responses are tx-closed: never partial transaction visibility.
- Masked transactions are indistinguishable from absent transactions on user-safe surfaces.
- `cursorAfter` advances only from actually returned visible events.

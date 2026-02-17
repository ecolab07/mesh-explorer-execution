# Phase 18 — Hardening & UX runtime note

## Invariants now enforced

- **Store unifié**: `connectionStatus`, `lastSync`, `cursor` are in the UI store and the status DOM binds only from store snapshots.
- **Cursor monotone**: incoming cursors are accepted only when `(metaSeq, graphSeq)` strictly advances.
- **Safe persistence**: cursor persistence is guarded so storage failures do not break sync flow.
- **Inter-channel dedup evidence**: tests prove no visible duplication for SSE re-delivery and poll/SSE overlap when cursor does not advance.
- **Connect/reconnect teardown**: each new connect rotates an `AbortController`, aborting the previous fetch/poll loop before starting a new one.

## Remaining backlog item

- Principal/graphSpace divergence validation in client payload handling remains open (no backend changes in this phase).

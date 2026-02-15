# SUPPORT_MATRIX

## 1) Implemented today

- **Node.js support**: Node 18+.
- **Module format**: ESM-only.
- **Runtime package**: `@mesh/runtime-local`.
- **CLI package**: `@mesh/cli`.
- **Backends**: Local backend only (`InMemoryLocalEventStore` and `FileBackedLocalEventStore`).
- **Desktop/Web**: `@mesh/runtime-local` targets Node.js runtime environments and is not a browser runtime.
- **Security behavior**: Security model is specified in the spec, but runtime-local currently does not activate payload masking or principal-based filtering.
- **Writer model**: single-writer behavior (no multi-writer support).

## 2) Spec-ready / Not implemented

- **IndexedDB backend**: not implemented.
- **Remote backend**: not implemented; future implementations are expected to conform to Remote EventStore Contract v1.
- **Sync/distributed operation**: not implemented as a real distributed runtime; v1 spec remains single-writer with no merge semantics.
- **Masking and filtered cursors**: spec-ready but not active in current runtime-local execution.

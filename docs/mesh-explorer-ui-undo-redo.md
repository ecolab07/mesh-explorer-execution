# Mesh Explorer UI: Canon vs UI-local layout, Undo/Redo limits

- Graph state is canonical and event-sourced: UI projection applies graph events from sync (`sync:poll` / `sync:subscribe`) via `applyGraphEvents`.
- 2D layout positions are UI-local only (force layout), never persisted as canonical graph data.
- Undo/Redo in the UI is implemented with compensating commands (`graph.node.label.updated`, `graph.node.deleted`, `graph.link.deleted`, and recreate commands).
- Node/link snapshots used by Undo/Redo intentionally exclude viewport positions.
- Undo determinism depends on explicit IDs for create-node/create-link snapshots. The server accepts explicit `id` payloads on create endpoints.

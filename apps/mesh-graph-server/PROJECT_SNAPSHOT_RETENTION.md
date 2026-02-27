# Project / Snapshot / Retention

The graph server now treats each project as an isolated graph space with its own persistent event store and retention policy.

## Core concepts

- **Project** (`projectId`): top-level namespace for graph commands/history.
- **Snapshot**: full graph projection (`nodes` + `links`) stored with an exact cursor.
- **Retention policy** (per project):
  - `ttlSeconds`
  - `maxEvents`
  - `snapshotEveryNEvents`
  - `snapshotEverySeconds`
  - `minSnapshotsToKeep`
  - `mode` (`archive` or `delete`)

## API summary

- `GET /v1/projects`
- `POST /v1/projects`
- `GET /v1/:projectId`
- `PATCH /v1/:projectId/retention`
- `POST /v1/:projectId/snapshots:create`
- `GET /v1/:projectId/snapshots`
- `GET /v1/:projectId/snapshots/:snapshotId`
- `GET /v1/:projectId/graph:snapshot`
- `POST /v1/:projectId/snapshots/:snapshotId:fork`
- `POST /v1/:projectId/history:purge`
- `GET /v1/:projectId/sync:poll`
- `GET /v1/:projectId/sync:subscribe`

`sync:poll` cursor semantics are `lastApplied`, so events are returned for `(cursor, cursorAfter]`.
`minReadableCursor` is interpreted as the minimal readable **start** seq (inclusive).

- `sync:poll` rejects with `cursor_too_old` (HTTP 410) when `cursor + 1 < minReadableCursor`.
- `sync:subscribe?from=...` uses the same exclusive semantics (`start = from + 1`) and rejects when `from + 1 < minReadableCursor`.

## Retention job

- `MESH_RETENTION_JOB_ENABLED` (`0` disables)
- `MESH_RETENTION_JOB_INTERVAL_MS` (override schedule)

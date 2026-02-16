# Mesh Integration v1 (Public)

Mesh is a deterministic, receipt-oriented execution and sync stack: writes are transaction-closed, replay is deterministic, and read/sync surfaces are principal-filtered with masking to prevent secret leakage.

## Quick start (Phase 17 app skeleton)

Start notes server:

```bash
MESH_NOTES_STORAGE_DIR=.mesh-notes-data node apps/mesh-notes-server/dist/index.js
```

Use CLI app against server:

```bash
node apps/mesh-app/dist/index.js create-note --baseUrl http://127.0.0.1:8080 --principal alice --title "hello" --body "mesh"
node apps/mesh-app/dist/index.js list-notes --baseUrl http://127.0.0.1:8080 --principal alice
node apps/mesh-app/dist/index.js watch --baseUrl http://127.0.0.1:8080 --principal alice
```

For replica usage (`startReplica` from source), see `apps/mesh-notes/README.md`.

## Sync endpoint safety model

- Use `/sync:pull` as source of truth (cursor-based polling, principal-filtered visibility).
- Use `/sync:subscribe` as best-effort low-latency hinting only.
- On disconnect/drift, resume from last persisted principal cursor and continue polling.

## Security model summary

- Principal identity comes from trusted principal mapping (e.g., `x-mesh-principal` in the reference adapter).
- Visibility is principal-filtered; unauthorized payloads are masked/non-visible.
- `NOT_FOUND_OR_MASKED` semantics prevent data-disclosure by response shape.

## Further reading

- `docs/recovery-endpoints-sync-v1.md`
- `docs/transport-surfaces-user-safe-vs-admin-safe.md`
- `docs/operational-guarantees.md`

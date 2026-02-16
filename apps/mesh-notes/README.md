# Mesh Notes App Skeleton v1

## Run server

```bash
MESH_NOTES_STORAGE_DIR=.mesh-notes-data node apps/mesh-notes-server/dist/index.js
```

## Run replica (from tests or local script)

Use `startReplica` from `apps/mesh-notes-replica/src/index.ts` and pass:

- `baseUrl`
- `principal`
- optional `cursorFile`

## CLI usage

```bash
node apps/mesh-app/dist/index.js create-note --baseUrl http://127.0.0.1:8080 --principal alice --title "t" --body "b"
node apps/mesh-app/dist/index.js list-notes --baseUrl http://127.0.0.1:8080 --principal alice
node apps/mesh-app/dist/index.js delete-note --baseUrl http://127.0.0.1:8080 --principal alice --id <id>
node apps/mesh-app/dist/index.js watch --baseUrl http://127.0.0.1:8080 --principal alice
```

## E2E tests

```bash
pnpm vitest run tests/e2e/app-skeleton.spec.ts
```

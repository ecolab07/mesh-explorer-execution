# HTTP/SSE reference adapter (Sync / Transport v1)

Le serveur de référence Node expose un pont réseau vers le transport interne (`LocalSyncGateway`) sans modifier le canon Command/Receipt/Error.

## Endpoints

- `POST /v1/:graphSpaceId/commands:submit`
  - Body: `Command` canonique JSON
  - Réponse: `TransactionReceipt` **ou** `CommandError`
  - Retry strict: même `(actorId, idempotencyKey)` ⇒ même réponse finale
- `GET /v1/:graphSpaceId/sync:pull?from=<cursor>&limitTx=&limitBytes=`
  - Réponse: `{ txBundlesVisible, cursorAfterVisible }`
  - Cursor principal-filtré, monotone, tx-closed
- `GET /v1/:graphSpaceId/sync:subscribe?from=<cursor>&heartbeatMs=`
  - `text/event-stream`
  - frames `SyncFrame` (`txBundles`, `cursor`, `heartbeat`)
  - best-effort: doublons possibles, reprise stateless via `from`

## Principal scoping minimal

Le header `x-mesh-principal` est requis. Il est mappé vers `PrincipalContext` pour activer le filtrage principal (allow/deny/mask) côté gateway/event store.

## Ack transport vs commit

Le transport peut accepter un message en entrée, mais **seule** la réponse finale (`TransactionReceipt` ou `CommandError`) représente le résultat canonique. Un ack transport n'est jamais un commit.

## Exemple rapide

```http
POST /v1/workspace-a/commands:submit
x-mesh-principal: alice
content-type: application/json

{"graphSpaceId":"workspace-a","commandId":"cmd-1","actorId":"writer","idempotencyKey":"k-1","payload":{"op":"SET"}}
```

```http
GET /v1/workspace-a/sync:pull?from=0&limitTx=32
x-mesh-principal: alice
```

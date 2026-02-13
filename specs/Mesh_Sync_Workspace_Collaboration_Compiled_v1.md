# Mesh Sync Workspace Collaboration Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: sync_transport_layer_v\_1.md

# Sync / Transport Layer v1

Version: 1.0\
Status: Normatif\
Fichier: `Sync_Transport_Layer_v1.md`

------------------------------------------------------------------------

## 0. Scope

Cette spécification définit la **couche de synchronisation et de
transport** entre **client(s)** et **backend(s)**, couvrant :

-   la **transmission des Commands** (UI/API → Runtime/Kernel)
-   la **propagation des Events** (EventStore → Runtime → clients)
-   la **cohérence des projections** côté client par gestion de
    **cursors**

Cette spécification **ne redéfinit pas** :

-   le schéma canonique des `Command`, `TransactionReceipt`,
    `CommandError`
-   l'enveloppe `EventEnvelope`, les streams `meta/graph`, ni
    l'invariant `tx-closed`
-   les règles de locks/collaboration, ni les permissions

Elle fixe uniquement :

-   les **endpoints/protocoles** minimaux
-   le modèle d'**acknowledgement** et de **receipts** au transport
-   les **garanties de livraison** (explicites)
-   les règles de **reconnexion** et de **reprise**

------------------------------------------------------------------------

## 1. Objectifs formels

### S1 --- Transport canonique, sans ambiguïté

La Sync Layer **MUST** transporter des `Command` canoniques vers le
backend et retourner exactement un résultat final (`TransactionReceipt`
ou `CommandError`) conforme au contrat Command/Intent API v1.

### S2 --- Synchronisation par cursors

La Sync Layer **MUST** permettre à un client de se synchroniser à un
curseur global admissible `K = (metaSeq, graphSeq)` et de maintenir un
état local cohérent par progression monotone des cursors.

### S3 --- Propagation event-driven (sans "état implicite")

La Sync Layer **MUST** propager les événements canonique EventStore
**sans altérer** leur contenu, leur ordre intra-stream, ni l'invariant
`tx-closed`.

### S4 --- Résilience aux pertes réseau

La Sync Layer **MUST** être tolérante aux déconnexions : le client doit
pouvoir reprendre à partir d'un curseur persisté localement (ou d'un
token de reprise) sans corruption.

### S5 --- Sécurité non-fuyante

La Sync Layer **MUST** respecter le modèle `allow | deny | mask` et
**MUST NOT** introduire de fuites d'existence via :

-   des différences de timing évidentes,
-   des erreurs détaillant des cibles masquées,
-   des notifications d'événements auxquelles le client ne doit pas
    avoir accès.

### S6 --- Compatibilité Workspace (GraphSpace)

Toutes les opérations de synchronisation **MUST** être explicitement
scoped par `graphSpaceId` (Workspace ↔ GraphSpace).

------------------------------------------------------------------------

## 2. Modèle de topologie (client--server minimal v1)

### 2.1 Rôles

-   **Client** : UI (desktop/web/mobile) ou intégration API.
-   **Sync Gateway** : façade transport (auth, sessions, multiplexing,
    backpressure).
-   **Runtime** : orchestration (soumission Commands au Kernel,
    observation commits, notifications non canoniques).
-   **Kernel** : exécution des Commands (validation, permissions, lock
    pessimiste, commit EventStore).
-   **EventStore** : source canonique de mémoire (streams `meta` et
    `graph`).

### 2.2 Flux minimaux

1)  **Submit** : Client → Sync Gateway → Runtime → Kernel → EventStore →
    Runtime → Sync Gateway → Client
2)  **Sync** : Client ↔ Sync Gateway (fetch/subscribe des Events)

### 2.3 Sessions et présence (non canonique)

La Sync Layer **MAY** exposer une notion de session/présence (utile UI),
mais :

-   la session n'a **aucune autorité ontologique**,
-   l'exécution d'une Command ne dépend pas strictement d'une session,
-   les messages de présence ne sont **pas** des événements EventStore.

------------------------------------------------------------------------

## 3. Protocole de transmission des Commands

### 3.1 Endpoint conceptuel

#### `POST /v1/{graphSpaceId}/commands:submit`

Entrée : `Command` (canonique).\
Sortie : `TransactionReceipt` **OU** `CommandError` (canonique).

Sémantique : une soumission côté client est une **proposition** ; le
serveur est **autoritatif** et décide l'ordre d'acceptation ainsi que la
position canonique (via `cursorAfter`).

Règles : 1. Le serveur **MUST** appliquer l'idempotence via
`(actor, idempotencyKey)`. 2. La réponse **MUST** être finale : -
`status="committed"` + `cursorAfter` si succès, - `status="rejected"` +
`category/reasonCode` si échec. 3. Si la même clé d'idempotence est
rejouée, le serveur **MUST** retourner **exactement** la même réponse
finale.

### 3.2 Responsabilité de déterminisme

-   La Sync Layer **NE DOIT PAS** transformer une `Command` canonique.
-   Elle **MAY** ajouter des métadonnées de transport (headers) sans
    effet sur la sémantique.

### 3.3 Timeouts et retries

-   Le client **MAY** réessayer un submit en cas d'erreur réseau.
-   Le client **MUST** réutiliser la même `idempotencyKey` pour un retry
    strict du même payload.
-   Le serveur **MUST** rendre ce retry sûr (exactly-once effectif au
    niveau sémantique via idempotence).

### 3.4 Batching au transport

Le batching suit le contrat `Command.batch` (atomic=true). La Sync Layer
:

-   **MUST** transporter les Commands du batch sans réordonner `index`.
-   **MUST** retourner un résultat atomique (receipt unique ou erreur
    finale), conformément au noyau.

------------------------------------------------------------------------

## 4. Modèle d'acknowledgement et receipts

### 4.1 Acknowledgement (niveau transport)

Le transport distingue deux niveaux :

-   **Ack transport** : « message reçu par la Sync Gateway » (non
    canonique).
-   **Receipt canonique** : résultat final de la Command
    (`TransactionReceipt` ou `CommandError`).

Règle : un ack transport **NE DOIT PAS** être interprété comme un
commit.

### 4.2 Receipts

La Sync Layer **MUST** retourner le `TransactionReceipt` canonique sans
altération.

Exigences minimales utiles au sync : - `cursorAfter` (pour avancer
l'état local) - `eventRefs` (pour inspection) - `entityIdMap` si commit
overlay (réconciliation IDs)

### 4.3 Receipts et cohérence de vue

Après un `TransactionReceipt.cursorAfter = K'` :

-   le client **MAY** considérer que l'état canonique est avancé à `K'`.
-   la propagation d'events vers ce client **MAY** arriver en double
    (voir §6), mais doit rester compatible avec la progression monotone
    par cursors.

------------------------------------------------------------------------

## 5. Propagation des Events et gestion des cursors

### 5.1 Principe : streams séparés, curseur global

Les événements sont propagés par stream `meta` et `graph`. Le client
maintient un curseur global :

`K = (metaSeq, graphSeq)`.

### 5.2 Endpoints conceptuels

#### `GET /v1/{graphSpaceId}/events:read`

Paramètres : - `stream` ∈ {`meta`, `graph`} (obligatoire) -
`fromSeqExclusive` (obligatoire) - `limit` (obligatoire)

Sortie : `EventEnvelope[]` en ordre croissant de `seq`.

Règles : 1. Le serveur **MUST** préserver l'ordre par `seq`. 2. Le
serveur **MUST** préserver `tx-closed` (aucune transaction partielle).

#### `GET /v1/{graphSpaceId}/sync:poll`

Paramètres : - `cursor` = `{ metaSeq, graphSeq }` (obligatoire) -
`limits` = `{ meta: n, graph: n }` (obligatoire)

Sortie :

``` json
{
  "meta":  [EventEnvelope...],
  "graph": [EventEnvelope...],
  "cursorAfter": { "metaSeq": int, "graphSeq": int }
}
```

Règles : 1. `cursorAfter.metaSeq` = dernier `meta.seq` renvoyé, sinon
égal à `cursor.metaSeq`. 2. `cursorAfter.graphSeq` = dernier `graph.seq`
renvoyé, sinon égal à `cursor.graphSeq`. 3. Chaque liste **MUST**
respecter `tx-closed`.

#### `GET /v1/{graphSpaceId}/sync:subscribe`

Objectif : flux continu (SSE/WebSocket/gRPC stream --- transport hors
scope).\
Entrée : `fromCursor = K`.

Contraintes : - `sync:subscribe` **MUST** être considéré **best-effort**
(pertes possibles, déconnexions possibles, duplications possibles). -
`sync:poll` est la **source de vérité** pour la complétude (recovery et
rattrapage).

Sortie : un flux de messages `SyncDelta` (voir §5.3).

### 5.3 Format de notification (transport)

``` txt
SyncDelta {
  graphSpaceId
  cursorBefore: { metaSeq, graphSeq }
  metaEvents?:  EventEnvelope[]
  graphEvents?: EventEnvelope[]
  cursorAfter:  { metaSeq, graphSeq }
}
```

Contraintes : 1. `cursorAfter` **MUST** être monotone (\>=) dans chaque
composante. 2. `cursorAfter` **MUST** être admissible (`tx-closed`). 3.
Si `metaEvents` et `graphEvents` sont présents dans un même delta,
l'application côté client **MUST** respecter l'ordre sémantique :
appliquer meta puis graph (à curseur donné).

### 5.4 Filtrage et sécurité

La Sync Layer **MUST** filtrer les événements envoyés au client selon
les permissions :

-   si l'accès à une entité est `mask`, le client **MUST NOT** recevoir
    d'événements qui prouvent l'existence de cette entité.
-   si le filtrage produit des "trous" apparents, la Sync Layer **MUST**
    compenser via des événements non révélateurs (p.ex. aucun détail, ou
    agrégation) ou omettre sans signaler la cible.

Note : le mécanisme exact de filtrage est hors scope, mais la propriété
"non fuyante" est normative.

### 5.5 Barrières inter-stream (optionnel v1)

L'ordre total inter-stream n'étant pas garanti, un consommateur **MAY**
définir des **barrières** de cohérence de lecture sous la forme :

-   `metaSeqApplied ≥ M` **ET** `graphSeqApplied ≥ G`

Une projection qui dépend des deux streams **MAY** attendre satisfaction
de la barrière avant de se déclarer « cohérente ».

### 5.6 Gestion des cursors côté client

Le client **MUST** persister au minimum :

-   `graphSpaceId`
-   `K_lastApplied = (metaSeq, graphSeq)` (durable)

Le client **MUST** assurer l'idempotence d'application des events :

-   **MUST** ignorer tout event déjà appliqué (par `eventId`),
-   **MUST** conserver une fenêtre de déduplication couvrant au minimum
    tous les events jusqu'au dernier curseur durablement appliqué.

Règle : le client **MUST NOT** reculer son curseur appliqué sauf
opération explicite de rewind (hors scope v1).

------------------------------------------------------------------------

## 6. Garanties de livraison

### 6.1 Commands

-   **At-least-once transport** (réseau) : une Command peut être envoyée
    plusieurs fois.
-   **Exactly-once sémantique** : le résultat observable sur le Graph
    est unique, garanti par l'idempotence `(actor, idempotencyKey)`.

### 6.2 Events

La Sync Layer **MUST** considérer la propagation d'events comme :

-   **At-least-once** vers le client (duplications possibles)
-   **In-order** par stream (ordre par `seq` respecté)
-   **Tx-closed** (pas de transaction partielle)

Détails normatifs (v1) : - `eventId` **MUST** être stable et opaque, et
unique au sens de l'Event Model v1. - Le serveur **MAY** redélivrer des
events déjà livrés. - Le client **MUST** ignorer tout event déjà
appliqué (par `eventId`). - Le client **MUST** persister `K_lastApplied`
durablement (commit cursor).

Conséquence : l'application des events doit tolérer duplication et
ré-ordonnancement inter-requêtes, tout en respectant l'ordre
intra-stream par `seq`.

### 6.3 Consistance de lecture

La Sync Layer **NE GARANTIT PAS** en v1 :

-   un ordre total inter-stream,
-   une "lecture transactionnelle" multi-requests côté client,
-   une cohérence forte entre l'état d'une projection UI locale et le
    commit global sans passer par cursors.

La cohérence normative est : **cohérence par cursors admissibles**.

------------------------------------------------------------------------

## 7. Gestion des reconnexions et reprise

### 7.1 Reconnexion (principe)

Après une déconnexion, le client reprend via :

-   **MUST** `sync:poll(cursor=K_lastApplied)` (source de vérité), puis
    boucle jusqu'à stabilisation,
-   **MAY** ensuite établir `sync:subscribe(fromCursor=K_lastApplied)`
    pour la faible latence.

### 7.2 Token de reprise (optionnel v1)

La Sync Layer **MAY** émettre un token opaque de reprise :

``` txt
CursorToken {
  graphSpaceId
  metaSeq
  graphSeq
  issuedAt
  signature?
}
```

Règles : 1. Un token **MUST** représenter un curseur admissible. 2. Un
token expiré/invalidé **MUST** provoquer un fallback : le client
réutilise son `K_lastApplied` brut ou redemande un token.

### 7.3 Détection de divergence locale

Le client **MUST** détecter et gérer :

-   **cursor gap** : événement manquant par rapport à `seq` attendu (=\>
    relire par `events:read`)
-   **cursor mismatch** : réception d'un delta dont `cursorBefore` ne
    correspond pas au curseur local (=\> resync par poll)

### 7.4 Reprise après submit incertain

Si le client a soumis une Command et perd la réponse :

-   il **MUST** resoumettre la même Command (même `idempotencyKey`).
-   le serveur **MUST** retourner le même receipt/erreur finale.

------------------------------------------------------------------------

## 8. Invariants systémiques

### INV-SYNC-1 --- Scope explicite par GraphSpace

Toute opération Sync **MUST** être scoped par `graphSpaceId`.

### INV-SYNC-2 --- Non-altération du canon

La Sync Layer **MUST NOT** modifier : `Command`, `TransactionReceipt`,
`CommandError`, `EventEnvelope`.

### INV-SYNC-3 --- Monotonicité des cursors

Tout `cursorAfter` retourné ou poussé **MUST** être monotone
(component-wise) et admissible (`tx-closed`).

### INV-SYNC-4 --- Ordre intra-transaction

Quand meta et graph d'une même transaction sont propagés ensemble,
l'application **MUST** respecter : meta puis graph.

### INV-SYNC-5 --- Sécurité non-fuyante

La Sync Layer **MUST** respecter `mask` : aucune fuite d'existence via
erreurs, locks, ou notifications.

### INV-SYNC-6 --- Tolérance à la duplication

Le protocole **MUST** rester correct si :

-   une Command est rejouée,
-   un Event est livré plusieurs fois,
-   un client redemande un range déjà appliqué.

------------------------------------------------------------------------

## 9. Limites assumées du v1

### L-SYNC-1 --- Pas d'exactly-once réseau

La Sync Layer ne cherche pas à garantir une livraison réseau
exactly-once ; elle garantit une sémantique stable via idempotence et
cursors.

### L-SYNC-2 --- Pas d'ordre total meta+graph

Le système n'impose pas d'ordre total inter-stream ; la cohérence repose
sur `K=(metaSeq, graphSeq)` et l'invariant `tx-closed`.

### L-SYNC-3 --- Pas de rebase automatique côté overlay

La Sync Layer ne résout pas les divergences d'overlay ; elle transporte
les erreurs de précondition (cursor mismatch) et laisse l'UI orchestrer
le workflow.

### L-SYNC-4 --- Pas de "push state" de projection

La Sync Layer transporte des événements et des cursors, pas des caches
de projection canonisés. Toute projection reste un cache dérivé et
reconstructible.

### L-SYNC-5 --- Filtrage fin d'events non détaillé

Le mécanisme exact de filtrage d'events par permissions est hors scope ;
seul l'invariant de non-fuite est normatif.

------------------------------------------------------------------------

## Source: collaboration_model_v\_1.md

# Collaboration Model v1 (Mesh Explorer)

Version: 1.0\
Status: Normatif

## 0. Scope et objectifs

Ce document formalise le **modèle de collaboration** pour : - l'édition
du **Graph (données)** - l'édition via **Overlay**
(Draft/Hypothesis/Annotation) - l'articulation avec **sessions**,
**locks**, **runtime** et **gestion des conflits**

Il est **strictement compatible** avec : - Event Model v1 - Command /
Intent API v1 - EventStore & Persistence v1 - Mutation Engine v1 -
Overlay System v1.5 - Permissions model

Ce document **n'ajoute pas** de nouveaux types d'événements ni de
nouveaux catalogues de commandes : il spécifie les **règles de
collaboration**, les **invariants** et les **comportements en cas de
conflit** au-dessus des contrats existants.

### Objectifs formels

O1 --- Déterminisme en présence de concurrence\
Le système **DOIT** rester déterministe : un état observé à un curseur
donné est reconstructible, et une commande est soit commitée
atomiquement, soit rejetée.

O2 --- Absence de merge concurrent (v1)\
Le système **NE DOIT PAS** tenter de fusionner deux écritures
concurrentes sur les mêmes entités ontologiques.

O3 --- Collaboration "sans magie"\
La collaboration **NE DOIT PAS** introduire de mutations implicites.
Toute modification du Graph passe par Command → Kernel → Transaction →
EventStore.

O4 --- Continuité Overlay\
Le modèle **DOIT** permettre le travail "en brouillon" (Overlay) sans
impacter la vérité ontologique tant que le commit n'a pas eu lieu.

O5 --- Sécurité non-fuyante\
Le modèle **DOIT** respecter les décisions `allow | deny | mask` et **NE
DOIT PAS** révéler des cibles masquées via des erreurs de locks.

------------------------------------------------------------------------

## 1. Définitions

### 1.1 Plans de collaboration

-   **Plan Graph** : modifications ontologiques réelles (GraphEvents).
-   **Plan Overlay** : modifications non ontologiques (DeltaSet /
    AnnotationSet) appliquées sur un Graph@rev pour produire un
    OverlayGraphView.
-   **Plan Meta** : hors scope direct (collaboration sur MetaGraph
    traitée par MetaDraft/merge dans d'autres documents).

### 1.2 Notion de conflit (v1)

En v1, un conflit est l'un des cas suivants : - **Lock contention** :
une commande vise une entité verrouillée. - **Staleness** : une commande
impose une précondition de curseur non satisfaite. - **Permission
mismatch** : `deny` ou `mask`.

Un conflit **n'est pas** un "merge" : aucune résolution automatique de
divergence n'existe en v1.

------------------------------------------------------------------------

## 2. Modèle de session

### 2.1 Session (normatif)

Une **Session** est une enveloppe runtime (éphémère, non canonique) qui
porte l'identité d'un acteur et un périmètre de collaboration.

``` txt
Session {
  sessionId
  actor: ActorRef
  createdAt
  lastSeenAt

  scope: SessionScope
  visibility: private | shared

  lease {
    ttlMs
    heartbeatRequired: bool
  }
}

SessionScope {
  graphSpace
  plane: graph | overlay
  overlayId?            // requis si plane=overlay
  contextRef?           // optionnel: contexte de projection/preview, non autoritatif
}
```

Règles : 1. Une Session **DOIT** être rattachée à un `actor` unique. 2.
`scope.plane` **DOIT** être `graph` ou `overlay`. 3. Si
`scope.plane = overlay`, `overlayId` **MUST** être présent. 4.
`visibility=shared` **MAY** être utilisée pour exposer une présence
(UI), mais **NE DOIT PAS** modifier les règles de permissions.

### 2.2 Durée et heartbeat

-   Une session a une **lease**.
-   Si `heartbeatRequired=true`, le runtime **MUST** expirer la session
    si aucun heartbeat n'est reçu avant `ttlMs`.
-   L'expiration d'une session **MUST** déclencher la libération de tous
    les locks détenus par la session.

### 2.3 Lien Session ↔ Command

-   `clientContext.uiSessionId` d'une Command (si fourni) **SHOULD**
    référencer `sessionId`.
-   L'absence de `uiSessionId` **NE DOIT PAS** empêcher l'exécution (la
    Command reste canonique).

------------------------------------------------------------------------

## 3. Spécification normative des locks

### 3.1 Nature (pessimistic locking v1)

Le verrouillage en v1 est **pessimiste** : une écriture requiert un lock
exclusif avant commit.

Propriété centrale : \> Une entité ciblée par une mutation est
verrouillée pendant la transaction.

### 3.2 Modèle de Lock

``` txt
Lock {
  lockId
  graphSpace
  plane: graph | overlay

  owner {
    actor: ActorRef
    sessionId?
  }

  mode: exclusive
  targets: EntityRef[]

  acquiredAt
  lease {
    ttlMs
    expiresAt
  }

  reason?   // debug interne
}
```

Contraintes : 1. `mode` **MUST** être `exclusive` (aucun shared lock en
v1). 2. `targets[]` **MUST** contenir des références stables
(GraphID/EdgeID/OverlayID) ; aucun identifiant local UI. 3. Un Lock
**MUST** être unique par `(graphSpace, plane, target)` et ne peut avoir
qu'un seul owner.

### 3.3 Granularité

#### 3.3.1 Plan Graph

-   Granularité minimale : **entity-level**.
-   Un lock Graph **MUST** cibler :
    -   `nodeId` pour mutations node
    -   `edgeId` pour mutations edge

Règle (multi-entités) : - Une transaction qui touche plusieurs entités
**MUST** acquérir un lock exclusif sur **toutes** les `targetEntities`
de la transaction, avant tout commit.

#### 3.3.2 Plan Overlay

-   Granularité v1 : **overlay-level**.
-   Un lock Overlay **MUST** cibler `overlayId` (un seul target).

Justification v1 : éviter les merges intra-overlay (DeltaSet concurrent)
qui ne sont pas supportés en v1.

### 3.4 Acquisition

#### 3.4.1 Ordonnancement d'acquisition (deadlock safety)

Pour éviter les deadlocks, l'acquisition multi-targets **MUST** suivre
un ordre total stable : - trier `targets` par `(kind, id)` selon un
comparateur canonique - acquérir dans cet ordre

#### 3.4.2 Timeout d'attente

-   Une tentative d'acquisition **MUST** respecter un
    `lockAcquireTimeoutMs` (config système).
-   Si l'acquisition n'aboutit pas dans le délai : rejeter la Command
    avec `CommandError.category = CONFLICT` et
    `reasonCode = CMD.CONFLICT.LOCKED`.

#### 3.4.3 Masquage sécurité

Si l'Authorize renverrait `mask` pour une cible, le système **MUST NOT**
révéler un état "locked by X". - Dans ce cas, la réponse **MUST** être
indistinguable d'un `NOT_FOUND` (avec `masked=true` si client
privilégié).

### 3.5 Lease, expiration, release

-   Tout lock **MUST** être un **lease** (TTL).
-   Le détenteur **SHOULD** envoyer un heartbeat tant que l'action
    utilisateur est en cours (si session).
-   À `expiresAt`, le lock **MUST** être libéré automatiquement.
-   La libération **MUST** également se produire :
    -   après commit (succès)
    -   après rejet avant commit (échec)
    -   à l'expiration de la session owner

### 3.6 Portée des locks (scope)

-   Un lock est scoped à `(graphSpace, plane)`.
-   Un lock Graph **NE DOIT PAS** bloquer l'édition overlay (qui est non
    ontologique) sauf au moment du commit overlay.

------------------------------------------------------------------------

## 4. Interaction Locks ↔ Overlay

### 4.1 Principe

Overlay produit un **OverlayGraphView** appliqué sur un `Graph@rev`.
Tant qu'il n'y a pas de commit, l'Overlay **n'écrit pas** dans le Graph.

Conséquence : - L'édition d'un Overlay (DeltaSet/AnnotationSet) peut
être rendue fluide sans locks Graph. - Le commit d'un Overlay est une
écriture Graph et suit les règles de locks Graph.

### 4.2 Édition d'un Overlay (v1)

-   Toute Command qui modifie le contenu d'un Overlay (ex: ajouter une
    opération au DeltaSet, modifier une annotation) **MUST** acquérir un
    lock Overlay exclusif sur `overlayId`.
-   Si le lock Overlay est détenu par un autre owner : rejet
    `CMD.CONFLICT.LOCKED`.

### 4.3 Commit d'un Overlay

Un commit overlay (OverlayDelta → Command → Transaction) suit : 1.
**Lock Overlay** (overlayId) pour geler le DeltaSet au moment du commit.
2. Résolution de `baseGraphRevision` → `graphSeqBase` via
`resolveRevision` (persistence layer). 3. Vérification de préconditions
de staleness (voir 4.4). 4. Calcul des `targetEntities` réelles visées
par le DeltaSet (après mapping tempId → GraphID quand applicable). 5.
**Lock Graph** exclusif sur ces `targetEntities`. 6.
Validation/permissions, commit, receipt. 7. Release locks (overlay puis
graph) en fin de traitement.

### 4.4 Staleness (baseGraphRevision)

En v1, le commit overlay **MUST** être protégé contre le changement du
Graph depuis `baseGraphRevision`.

Règle normative : - Après
`resolveRevision(overlay.baseGraphRevision) -> graphSeqBase`, le Kernel
**MUST** exiger : - `currentGraphSeq == graphSeqBase` - Sinon : rejeter
avec `CommandError.category = PRECONDITION` et
`reasonCode = CMD.PRECONDITION.CURSOR_MISMATCH`.

Note : cette règle est volontairement stricte (pas de rebase automatique
en v1).

### 4.5 OverlayLocalID et mapping

-   Les créations dans un Overlay utilisent des identifiants locaux
    jusqu'au commit.
-   Le receipt de commit overlay **MUST** fournir `entityIdMap[]`
    (tempId → realId) pour toutes les créations.

------------------------------------------------------------------------

## 5. Comportement en cas de conflit

### 5.1 Conflit de lock

-   Si un lock requis est détenu : `CommandError.category = CONFLICT`,
    `reasonCode = CMD.CONFLICT.LOCKED`.
-   Le message **MAY** inclure un hint non sensible (ex: "resource
    busy"), mais **MUST NOT** révéler l'identité de l'owner si la cible
    est masquée ou si l'utilisateur n'a pas le droit de lire l'entité.

### 5.2 Conflit de précondition (stale cursor)

-   Si `requireGraphCursor` est fourni et non satisfait :
    `PRECONDITION / CMD.PRECONDITION.CURSOR_MISMATCH`.
-   Pour commit overlay, la règle 4.4 s'applique même sans
    `requireGraphCursor` explicite (précondition implicite du workflow
    commit overlay).

### 5.3 Conflit de permissions

-   `deny` : `PERMISSION` avec code `DENY.<ACTION>.<TARGET>.<DETAIL>`.
-   `mask` : `PERMISSION` avec `CMD.PERMISSION.MASKED`, et réponse
    extérieure indistinguable d'un `NOT_FOUND`.

### 5.4 Aucune résolution automatique

-   Le système **NE DOIT PAS** proposer un merge.
-   Les seules issues sont :
    -   attendre / réessayer (idempotence supportée)
    -   abandonner
    -   ouvrir un overlay et recommencer sur une base stable

------------------------------------------------------------------------

## 6. Contraintes liées au pessimistic locking (choix v1)

### 6.1 Propriétés garanties

-   Pas de write-write conflict sur le Graph : l'exclusivité empêche la
    concurrence.
-   Transactions simples à raisonner : commit atomique ou rejet.
-   Déterminisme renforcé (pas de merge non déterministe).

### 6.2 Coûts et effets

-   Concurrence réduite sur des "hotspots" (entités très éditées).
-   Risque d'attente / contention si granularité trop large.
-   Besoin de TTL/heartbeats pour éviter les locks orphelins.

### 6.3 Règle de design v1

-   Préférer la granularité entity-level côté Graph.
-   Ne pas introduire de locks hiérarchiques (subtree/region) en v1.

------------------------------------------------------------------------

## 7. Rôle du Runtime dans la collaboration

### 7.1 Principe

Le Runtime orchestre : - la soumission des Commands au Kernel -
l'observation des commits (EventStore) - l'application des deltas en
mémoire - la notification des projections ouvertes

Le Runtime **NE DOIT PAS** : - valider à la place du Kernel - inventer
des locks - écrire dans l'EventStore

### 7.2 Consistance UI (feedback)

Après receipt : - le Runtime **SHOULD** diffuser aux clients concernés
un événement "de présence" non canonique (ex: "entity changed" ou
"overlay updated") basé sur les deltas, pour rafraîchir les vues.

Ces notifications **NE SONT PAS** des événements canonique EventStore.

------------------------------------------------------------------------

## 8. Invariants systémiques (v1)

I1 --- Transaction atomique visible\
Aucun consommateur ne peut observer une transaction partielle
(tx-closed).

I2 --- Lock avant commit\
Toute écriture Graph **MUST** acquérir des locks exclusifs sur toutes
les cibles de la transaction avant commit.

I3 --- Overlay isolant\
Un Overlay n'a aucune autorité ontologique tant qu'il n'est pas commit.

I4 --- Overlay commit strict\
Un commit overlay **MUST** échouer si le Graph a divergé depuis la base
(pas de rebase automatique en v1).

I5 --- Sécurité non fuyante\
Les locks et les erreurs associées **MUST NOT** divulguer l'existence
d'entités masquées.

I6 --- Idempotence\
Une répétition de Command avec la même clé **MUST** retourner le même
résultat final.

------------------------------------------------------------------------

## 9. Limites assumées du modèle v1

L1 --- Pas de co-édition fine d'un même Overlay\
Le modèle v1 impose un lock overlay-level exclusif : un seul éditeur
actif par overlay.

L2 --- Pas de rebase/merge d'Overlay\
Si le Graph change, l'Overlay doit être recréé ou ré-ancré manuellement
(workflow côté UI), car le commit exige une base identique.

L3 --- Pas de locks partagés / lecture-consistante\
Les locks sont exclusifs et ne modélisent pas de lecture
transactionnelle multi-étapes.

L4 --- Pas de "réservation" longue durée sur le Graph\
Les locks sont des leases courtes : pas de checkout longue durée d'un
sous-graphe.

------------------------------------------------------------------------

## 10. Annexes (codes d'erreur attendus)

-   CONFLICT
    -   `CMD.CONFLICT.LOCKED`
    -   `CMD.CONFLICT.BUSY`
-   PRECONDITION
    -   `CMD.PRECONDITION.CURSOR_MISMATCH`
    -   `CMD.PRECONDITION.OVERLAY_STATUS_NOT_DRAFT`
-   PERMISSION
    -   `DENY.<ACTION>.<TARGET>.<DETAIL>`
    -   `CMD.PERMISSION.MASKED`

------------------------------------------------------------------------

## Source: import_export_interop_v\_1.md

# Import_Export_Interop_v1.md

Version: 1.0\
Status: Normatif\
Scope: Workspace / Project / Package --- Import / Export /
Interoperability v1

------------------------------------------------------------------------

# 0. Scope

Cette spécification formalise le mécanisme canonique d'**import / export
/ interopérabilité** pour :

-   Workspace (GraphSpace complet)
-   Project (subset déclaratif)
-   Package (snapshot figé à un curseur K)

Elle est strictement compatible avec :

-   Workspace / Project / Packaging v1
-   Event Model v1
-   EventStore & Persistence v1
-   Identity & Addressing v1
-   Command / Intent API v1
-   Mutation Engine v1
-   Type System UI v1
-   Collaboration Model v1

Elle n'introduit aucun nouveau mécanisme transactionnel ou événementiel.
Toute écriture résultant d'un import passe par Command → Transaction →
EventStore.

------------------------------------------------------------------------

# 1. Objectifs formels

## O1 --- Canon transportable

Définir un format d'export **auto‑suffisant**, versionné et vérifiable.

## O2 --- Reconstructibilité déterministe

Garantir que tout export à un curseur K = (metaSeq, graphSeq) puisse
reconstruire :

-   MetaState(metaSeq)
-   GraphState(K)

sans dépendance externe implicite.

## O3 --- Intégrité forte

Permettre :

-   validation structurelle
-   vérification d'intégrité (hash/digest)
-   détection d'altération

## O4 --- Compatibilité contrôlée

Assurer :

-   compatibilité MetaGraph (version pinning)
-   migrations explicites si nécessaire
-   absence de mutation silencieuse

## O5 --- Séparation vérité / transport

Un export n'est jamais source de vérité. L'import ne peut écrire que via
des transactions atomiques.

## O6 --- Interopérabilité minimale

Permettre l'échange entre Workspaces distincts (fork, clone, migration
environnementale).

------------------------------------------------------------------------

# 2. Typologie des exports v1

## 2.1 Export canonique v1 = Package Snapshot

En v1 minimal et sûr, l'export canonique est **un snapshot figé** à un
curseur admissible K = (metaSeq, graphSeq), conforme
Workspace/Project/Packaging v1.

Contenu : - MetaState(metaSeq) - GraphState(K) - cursorRef K -
manifest + intégrité

Propriété : - état figé, auto-suffisant - pas d'historique complet
transporté

## 2.2 Project Export

Contenu : - définition Project (criteriaDefinition) - metadata - version

Ne contient jamais de données Graph.

## 2.3 Exports hors scope v1

Les exports suivants sont **hors scope v1** : - export complet
EventStore (Full Event Export) - packages delta/patch - export de
caches/projections/sessions/locks

------------------------------------------------------------------------

# 3. Format canonique d'un Package exporté

## 3.1 Structure logique

    Package {
      packageId
      formatVersion

      source {
        graphSpaceId
        workspaceId?
      }

      cursorRef {
        metaSeq
        graphSeq
      }

      meta {
        metaVersionIdActive
        serializedMetaState
      }

      graph {
        serializedGraphState
      }

      manifest
      integrity
    }

## 3.2 Manifest

    PackageManifest {
      packageId
      exportTimestamp

      sourceGraphSpaceId
      cursorRef
      metaVersionIdActive

      exportFormatVersion
      toolVersion?

      compatibility {
        metaVersionRequired
        minImportFormatVersion
      }

      checksums {
        metaDigest
        graphDigest
        packageDigest
      }
    }

Contraintes : 1. `cursorRef` MUST être tx-closed. 2.
`metaVersionIdActive` MUST correspondre au dernier publish ≤ metaSeq. 3.
`exportFormatVersion` MUST être SemVer.

## 3.3 SerializedMetaState

Représentation complète et déterministe de :

MetaState(metaSeq)

Inclut : - modules - types - relations - policies - contraintes

## 3.4 SerializedGraphState

Représentation complète et déterministe de :

GraphState(K)

Inclut : - nodes - edges - props

Ne contient pas : - violations - projections - caches - sessions - locks

------------------------------------------------------------------------

# 4. Règles d'intégrité

## 4.1 Digests

Le package MUST inclure :

-   hash(metaState)
-   hash(graphState)
-   hash(package global)

Algorithme non imposé, mais : - stable - déterministe

## 4.2 Validation structurelle

À l'import :

1.  Vérifier formatVersion supporté
2.  Vérifier structure JSON conforme
3.  Vérifier cohérence cursorRef
4.  Vérifier checksums

Tout échec → import rejeté.

## 4.3 Signature (optionnelle v1)

Un package MAY inclure :

    signature {
      algorithm
      publicKeyId
      signatureValue
    }

Si présente : - signature MUST être vérifiée avant import

------------------------------------------------------------------------

# 5. Gestion des identifiants à l'import

## 5.1 Règle canonique v1 = conservation des IDs

En v1 minimal et sûr, l'import se fait dans un Workspace vide.

Conséquence : - GraphNodeID et GraphEdgeID sont **conservés**. - TypeID,
FieldID, RelationTypeID, PolicyID, ConstraintID, InvariantID sont
**conservés**.

## 5.2 Interdiction du remapping v1

Le remapping d'identifiants (Graph ou Meta) est **hors scope v1**.

Raison : - le remapping exige une table de correspondance normative
persistable - il introduit des ambiguïtés d'interopérabilité (références
externes, audit, inspection)

## 5.3 Invariants

1.  Aucun ID ne doit entrer en collision dans le GraphSpace cible
    (garanti par "Workspace vide").
2.  Les IDs canoniques restent opaques, immuables et non recyclés.

------------------------------------------------------------------------

# 6. Compatibilité MetaGraph

## 6.1 Version pinning

Le package contient :

`metaVersionIdActive`

À l'import :

Cas 1 --- Workspace cible vide\
→ recréer MetaGraphVersion identique

Cas 2 --- Workspace cible non vide

Comparer :

-   metaVersion cible
-   metaVersion package

Résultat :

-   Identique → OK
-   Compatible → migration requise
-   Incompatible → rejet

## 6.2 Migration requise

Si migration nécessaire :

1.  Générer MigrationPlan
2.  Dry-run
3.  Validation
4.  Exécution via Commands

Aucune migration implicite.

------------------------------------------------------------------------

# 7. Stratégie d'import

## 7.1 Principe général (dur)

L'import ne peut jamais écrire directement dans l'EventStore.

Il DOIT : - produire des Commands - générer des Transactions atomiques -
respecter la validation et les permissions

## 7.2 Stratégie canonique v1 = Injection d'état matérialisé (Snapshot)

Processus :

1.  Vérifier intégrité + format (voir §4).
2.  Vérifier que le Workspace cible est **vide** (voir §8.3).
3.  Injecter la loi : publier la MetaGraphVersion correspondant à
    `MetaState(metaSeq)`.
4.  Injecter les données : créer nodes/edges et propriétés via batchs de
    Commands.
5.  Obtenir un curseur final (metaSeq, graphSeq) correspondant à l'état
    importé.

Propriété : - l'état final est équivalent au GraphState(K) importé. -
aucune "histoire" n'est importée.

## 7.3 Ordonnancement d'injection

-   Les types et artefacts meta **MUST** être publiés avant toute
    écriture graph.
-   L'injection graph **MUST** respecter les dépendances (nœuds avant
    relations).

## 7.4 Atomicité (v1)

L'import complet est une opération **logiquement atomique**, mais peut
être réalisé en plusieurs transactions pour raisons de volumétrie.

Exigences : - les batchs **MUST** être ordonnés et idempotents - si un
batch échoue, l'import est considéré en échec - la remédiation v1 est :
**purge du Workspace cible** (Workspace vide requis)

------------------------------------------------------------------------

# 8. Gestion des conflits à l'import

## 8.1 Types de conflits

-   ID collision
-   Meta incompatibility
-   Permission insuffisante
-   Lock contention
-   Staleness

## 8.2 Règles

1.  Aucun merge automatique de Graph existant.
2.  Aucun merge implicite Meta.
3.  Toute incompatibilité Meta non migrable → rejet.
4.  Permissions évaluées normalement (allow \| deny \| mask).

## 8.3 Import dans Workspace non vide (interdit v1)

En v1 minimal et sûr :

-   Import d'un Package dans un Workspace non vide : **INTERDIT**.

Raison : - aucun merge de Graph n'est défini en v1 - aucune
réconciliation Meta n'est définie en v1 - le déterminisme et la sécurité
priment sur l'"assemblage"

Conséquence normative : - l'import cible un Workspace vide, ou doit être
précédé d'une opération externe de fork/clone vers un Workspace vide.

------------------------------------------------------------------------

# 9. Invariants systémiques

1.  Un Package n'est jamais source de vérité.
2.  Toute écriture issue d'un import passe par Transaction.
3.  Le curseur final est tx-closed.
4.  Aucun snapshot runtime non canonique n'est importé.
5.  Les violations ne sont jamais persistées.
6.  Les IDs méta restent stables.
7.  Les Derived et Projections ne sont jamais exportés.
8.  Un Workspace importé reste reconstructible par replay.
9.  Aucun import ne peut contourner validation Type Engine.
10. L'import ne peut pas contourner permissions.

------------------------------------------------------------------------

# 10. Résumé

Import / Export v1 est :

-   déterministe
-   transactionnel
-   non magique
-   versionné
-   vérifiable
-   compatible avec le modèle événementiel

Il transporte un état. Il ne transporte jamais l'autorité. La vérité
reste dans l'EventStore reconstruit par transaction.

------------------------------------------------------------------------

## Source: workspace_project_packaging_v\_1.md

# Workspace_Project_Packaging_v1.md

Version: 1.0\
Status: Normatif

------------------------------------------------------------------------

# 0. Scope

Ce document définit le modèle canonique **Workspace / Project / Package
v1**.

Contraintes structurantes v1 :

-   1 Workspace = 1 GraphSpace = 1 EventStore = 1 bundle de stockage.
-   Multi-GraphSpaces hors scope (gérés par un conteneur supérieur futur
    : WorkspaceGroup / Universe).
-   Project = subset dynamique sans autorité ontologique.
-   Package = snapshot exporté à un curseur K.
-   Racine canonique d'adressage = GraphSpaceID (WorkspaceID est
    administratif).

Ce document n'introduit aucun mécanisme transactionnel ou événementiel
nouveau.

------------------------------------------------------------------------

# 1. Définitions normatives

## 1.1 Workspace

### Définition

Un Workspace est l'unité canonique d'isolation ontologique complète.

Formellement :

    Workspace {
      workspaceId          // administratif
      graphSpaceId         // racine canonique d’adressage
      lifecycleState       // active | frozen | archived
      metadata
    }

### Invariants

1.  Un Workspace contient exactement **un GraphSpace**.
2.  Un GraphSpace appartient à exactement **un Workspace**.
3.  Un Workspace contient exactement **un EventStore** (streams meta +
    graph).
4.  Tous les IDs canoniques sont scoped par `graphSpaceId`.
5.  Les cursors `(metaSeq, graphSeq)` sont locaux au Workspace.

Le Workspace est la frontière de reconstruction complète par replay.

------------------------------------------------------------------------

## 1.2 Project (v1)

### Définition

Un Project est une **définition de subset dynamique** du Graph.

Il n'a aucune autorité ontologique.

Formellement :

    Project {
      projectId
      graphSpaceId
      criteriaDefinition   // sélection déclarative
      metadata
      version
    }

### Nature

Un Project est :

-   une vue organisationnelle
-   une sélection par critères (types, relations, propriétés, patterns)
-   éventuellement associé à des configurations UI

### Invariants

1.  Un Project ne possède ni EventStore ni stream dédié.
2.  Un Project ne modifie pas la validation.
3.  Un Project ne modifie pas les permissions.
4.  Les mutations restent globales au Workspace.
5.  Un Project ne peut jamais contourner les règles ontologiques.

Les partitions fortes (permissions isolées, overrides méta, migrations
ciblées) sont hors scope v1.

------------------------------------------------------------------------

## 1.3 Package (v1)

### Définition

Un Package est un **snapshot exporté à un curseur K = (metaSeq,
graphSeq)**.

Formellement :

    Package {
      packageId
      sourceGraphSpaceId
      cursorRef { metaSeq, graphSeq }
      manifest
      serializedState
      version
    }

### Nature

Un Package v1 est :

-   un état figé
-   auto‑suffisant
-   reconstructible

Ce n'est pas un delta transportable.

### Invariants

1.  Un Package n'est jamais source de vérité.
2.  L'import d'un Package produit des Commands → Transactions.
3.  Les violations ne sont jamais persistées dans un Package.
4.  Les snapshots runtime non canoniques ne sont pas exportés.

Les Patch/Delta packages sont hors scope v1.

------------------------------------------------------------------------

# 2. Frontières et scoping

## 2.1 Ce qui vit dans un Workspace

### Canonique

-   EventStore (meta + graph)
-   Transactions
-   MetaGraphVersions
-   GraphState (reconstructible)
-   Snapshots meta/graph
-   Overlays

### Non-canoniques

-   ProjectionCaches
-   Sessions
-   Locks
-   Derived temporaires

------------------------------------------------------------------------

## 2.2 Racine d'adressage

La racine canonique est :

    graphSpaceId

`workspaceId` est administratif uniquement.

Aucune fédération URI n'est définie en v1.

------------------------------------------------------------------------

# 3. Modèle de versioning

## 3.1 État d'un Workspace

L'état est déterminé exclusivement par :

    K = (metaSeq, graphSeq)

WorkspaceState(K) est déterministe.

------------------------------------------------------------------------

## 3.2 Meta

Les MetaGraphVersions sont immuables.

Un Workspace peut contenir :

-   plusieurs versions publiées
-   une version active implicite (dérivée de metaSeq)

------------------------------------------------------------------------

## 3.3 Project versioning

Un Project est versionné indépendamment :

    ProjectVersion {
      projectId
      version
      criteriaHash
    }

La version d'un Project n'impacte pas le Graph.

------------------------------------------------------------------------

## 3.4 Package versioning

Un Package contient :

    PackageManifest {
      sourceGraphSpaceId
      cursorRef
      metaVersionIdActive
      exportFormatVersion
      checksum
    }

------------------------------------------------------------------------

# 4. Layout canonique (logique)

    Workspace/
      manifest.json

      eventstore/
        meta/
        graph/

      snapshots/
        meta/
        graph/

      overlays/

      projects/
        <projectId>/
          project.json
          versions/

      exports/
        packages/

Implémentation physique libre si invariants respectés.

------------------------------------------------------------------------

# 5. Lifecycle du Workspace

## 5.1 Clone

Clone = duplication complète :

-   nouveau workspaceId
-   nouveau graphSpaceId
-   EventStore copié
-   état identique au curseur choisi

Clone conserve l'historique.

------------------------------------------------------------------------

## 5.2 Fork

Fork = création d'un nouveau Workspace :

-   nouveau graphSpaceId
-   base copiée à un curseur K
-   divergence possible ensuite

Les identités internes restent valides dans le nouveau scope.

------------------------------------------------------------------------

## 5.3 Freeze / Archive

### Freeze

-   état read‑only
-   aucune Command mutante acceptée
-   EventStore append bloqué

### Archive

-   état figé
-   usage uniquement lecture / export

Un Workspace frozen ou archived reste reconstructible.

------------------------------------------------------------------------

# 6. Règles de référence

## 6.1 Project

Un Project peut référencer :

-   TypeID
-   RelationTypeID
-   PolicyID
-   critères de sélection

Il ne peut référencer :

-   OverlayLocalID
-   DerivedID instable
-   Sessions
-   Locks

------------------------------------------------------------------------

## 6.2 Package

Un Package peut contenir :

-   MetaState à metaSeq
-   GraphState à graphSeq
-   manifest

Il ne peut contenir :

-   locks
-   sessions
-   caches runtime
-   projections matérialisées

------------------------------------------------------------------------

# 7. Import / Export (préparation 4.7)

## 7.1 Export Workspace complet

Deux stratégies :

### Full Event Export

-   export complet EventStore
-   snapshots optionnels

### Snapshot Export

-   export MetaState(metaSeq)
-   export GraphState(K)
-   inclure K

------------------------------------------------------------------------

## 7.2 Import Package

Processus normatif :

1.  Valider compatibilité meta.
2.  Recréer MetaGraphVersion si nécessaire.
3.  Injecter Graph via Commands.
4.  Commit transactionnel.

Aucune écriture directe dans l'EventStore.

------------------------------------------------------------------------

# 8. Invariants systémiques

1.  1 Workspace = 1 GraphSpace.
2.  1 Workspace = 1 EventStore.
3.  Workspace reconstructible intégralement par replay.
4.  Project sans autorité ontologique.
5.  Package non autoritatif.
6.  Toute écriture passe par Transaction atomique.
7.  Freeze bloque toute mutation.
8.  Fork crée un nouveau graphSpaceId.
9.  workspaceId n'est jamais racine canonique d'adressage.
10. Aucun composant organisationnel ne contourne validation ou
    permissions.

------------------------------------------------------------------------

# 9. Résumé

Workspace = univers ontologique complet. Project = découpe logique
dynamique. Package = état figé exportable.

La vérité reste :

-   EventStore
-   MetaGraphVersion
-   Transactions
-   Cursors

Tout le reste est organisation, transport ou projection.

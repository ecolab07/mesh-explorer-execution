# Mesh Core Specs Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: foundations.md

# Mesh-Explorer --- Foundations

## Ontologie

-   **Nœud** : entité sans sens intrinsèque (identité technique)
-   **Relation** : entité ontologique à part entière
-   **Sens** : porté par la relation + son type
-   **Type** : mini-système (lois locales)
-   **Identité** : purement technique
-   **Monde** : constellation de graphes
-   **Graphe** : univers local

## Types

-   Chaque nœud et relation possède un type (défaut possible)
-   Type = mini-système :
    -   règles
    -   contraintes
    -   comportements
    -   projections
    -   visuel
    -   réparations
-   Hiérarchie globale des types
-   Priorité définie dans le type
-   Helper contextuel pour visualiser l'écosystème des priorités

## Règles

-   Priorité d'exécution :
    -   Synchrone
    -   Transactionnelle
-   Extensions possibles :
    -   Réactive
    -   Conditionnelle
    -   Manuelle
    -   Assistée
    -   Simulée
    -   Déclarative

## Ordonnancement

-   Ordre = priorité par type

## Conflits

Ordre de résolution : 1. Bloquer 2. Demander utilisateur 3. Proposer
scénarios 4. Rollback + mode automatique optionnel

## Mutations

-   Mutation = transaction atomique
-   Bloc indivisible
-   Rollback possible

## EventStore

-   Logs
-   Undo/Redo
-   Rollback
-   Mémoire opératoire
-   Non source de vérité

## Projections

-   Toujours reconstruites depuis l'EventStore
-   Vues dérivées
-   Pas de vérité projetée

## Export

-   Graph → FS :
    -   Relation enfant = dossier
    -   Autres relations = perte sémantique contrôlée
-   Graph → Graph : réutilisable, synchronisable

## Fichiers

-   Nœuds et relations peuvent posséder des fichiers
-   Fichier = document lié
-   Pas de statut

## Moteur

-   Priorité : cohérence, robustesse, exactitude
-   Puis fluidité, vivant

  -------------
  Document
  généré depuis
  la phase
  fondation
  ontologique

  -------------

## Source: event_model_v\_1.md

# Event_Model_v1.md

**Mesh Explorer --- Event Model v1 (Canonique)**\
Version: 1.0\
Status: Normatif

------------------------------------------------------------------------

# 1. Scope

Ce document définit le modèle canonique des événements de Mesh Explorer
couvrant :

-   GraphEvents (réalité)
-   MetaEvents (loi)
-   Enveloppe canonique
-   Transactions et cursors
-   Versioning
-   Invariants formels
-   Compatibilité avec :
    -   Mutation Engine v1
    -   Graph Runtime v1
    -   Projection Engine v1

Ce document ne redéfinit pas les moteurs existants. Il fixe le contrat
événementiel commun.

------------------------------------------------------------------------

# 2. Définitions formelles

## 2.1 Streams

Deux streams append-only indépendants :

-   `M = [m1, m2, …]` : stream `meta`
-   `G = [g1, g2, …]` : stream `graph`

Chaque stream est totalement ordonné par un entier strictement croissant
`seq`.

------------------------------------------------------------------------

## 2.2 Global Event Cursor

Le curseur global est une paire :

    K = (metaSeq, graphSeq)

où :

-   `metaSeq` = dernier `seq` observé dans le stream meta
-   `graphSeq` = dernier `seq` observé dans le stream graph

Il n'existe pas d'ordre total inter-stream.

------------------------------------------------------------------------

## 2.3 Logical Snapshot

    LogicalSnapshot(K) = MetaState(metaSeq)

où :

    MetaState(metaSeq) = fold(δM, MetaState₀, M≤metaSeq)

------------------------------------------------------------------------

## 2.4 Graph State

    GraphState(K) = fold( (S,e) → δG(S,e, LogicalSnapshot(K)), GraphState₀, G≤graphSeq )

------------------------------------------------------------------------

## 2.5 Violation Set

Les violations sont dérivées :

    ViolationSet(K) = check(GraphState(K), LogicalSnapshot(K))

Les violations ne sont jamais persistées.

------------------------------------------------------------------------

# 3. Enveloppe canonique

``` json
EventEnvelope {
  eventId: string,
  stream: "meta" | "graph",
  seq: integer,

  txId: string,
  txIndex: integer,

  author: ActorRef,
  timestamp: ISO8601,

  eventType: string,
  schemaVersion: SemVer,

  targetEntities: EntityRef[],
  payload: object
}
```

## Contraintes

1.  `seq` strictement croissant dans son stream.
2.  `txIndex` unique par `(txId, stream)` et dense à partir de 0.
3.  `eventId` globalement unique.
4.  Aucun événement n'est modifiable après commit.

------------------------------------------------------------------------

# 4. Transactions

## 4.1 Définition

Une transaction `T` est un ensemble atomique d'événements partageant un
`txId`.

    T = { metaEvents[T], graphEvents[T] }

## 4.2 Ordre sémantique interne

Dans toute transaction :

    metaEvents[T] précèdent logiquement graphEvents[T]

## 4.3 Attribution des seq

Si le curseur avant T est `(m0, g0)` :

-   metaEvents reçoivent `seq = m0+1 … m0+k`
-   graphEvents reçoivent `seq = g0+1 … g0+n`

Cursor après commit :

    (metaSeq, graphSeq) = (m0+k, g0+n)

## 4.4 Invariant tx-closed

Un curseur admissible ne peut jamais représenter une transaction
partielle.

Si un événement d'un `txId` est visible, tous les événements de ce
`txId` sont visibles.

------------------------------------------------------------------------

# 5. GraphEvents (normatif)

## 5.1 Node

### graph.node.added

``` json
{ nodeId, typeId, props }
```

### graph.node.updatedProps

``` json
{ nodeId, patch }
```

Patch = merge-patch (RFC 7396-like).

### graph.node.deleted

``` json
{ nodeId, mode: "hard" }
```

Suppression des edges non implicite (doit être explicite via
graph.edge.deleted).

------------------------------------------------------------------------

## 5.2 Edge

### graph.edge.added

``` json
{ edgeId, fromId, toId, relationTypeId, props }
```

### graph.edge.updatedProps

``` json
{ edgeId, patch }
```

### graph.edge.deleted

``` json
{ edgeId, mode: "hard" }
```

------------------------------------------------------------------------

# 6. MetaEvents (normatif)

MetaEvents décrivent les mutations du MetaState.

## 6.1 Version pivot

### meta.version.published

``` json
{
  metaVersionId,
  parentMetaVersionId,
  draftId,
  summary,
  digest
}
```

Chaque version publiée correspond à un état stable inspectable.

------------------------------------------------------------------------

## 6.2 Types

-   meta.type.created
-   meta.type.renamed
-   meta.type.deprecated

Les identifiants (`typeId`) sont stables.

------------------------------------------------------------------------

## 6.3 Fields

-   meta.field.added
-   meta.field.renamed
-   meta.field.updated
-   meta.field.deprecated

------------------------------------------------------------------------

## 6.4 RelationTypes

-   meta.relationType.created
-   meta.relationType.renamed

------------------------------------------------------------------------

## 6.5 Constraints (forward-only)

### meta.constraint.added

``` json
{
  constraintId,
  scope,
  kind,
  params,
  enforcement: "forward-only"
}
```

### meta.constraint.updated

### meta.constraint.removed

### Invariant

Une contrainte publiée :

-   n'empêche jamais le publish,
-   interdit seulement les nouvelles mutations non conformes.

------------------------------------------------------------------------

## 6.6 Policies

-   meta.policy.updated

Appliquées à la validation des commandes futures.

------------------------------------------------------------------------

## 6.7 Refactors résolubles (obligatoire)

Tout `meta.refactor.*` doit inclure :

    resolution

qui garantit la résolubilité des références existantes.

Un refactor non résoluble est interdit au commit.

------------------------------------------------------------------------

# 7. Invariants globaux

## 7.1 Immutabilité

L'EventStore est append-only.

## 7.2 Déterminisme

Pour tout curseur admissible K :

    GraphState(K),
    LogicalSnapshot(K),
    ViolationSet(K)

sont déterministes et reconstructibles par replay.

## 7.3 Séparation ontologique

-   GraphEvents = faits réels
-   MetaEvents = loi
-   Violations = artefacts dérivés
-   Projections = vues dérivées

## 7.4 Application Runtime

Pour chaque transaction :

1.  appliquer metaEvents
2.  produire LogicalSnapshot
3.  appliquer graphEvents sous ce snapshot
4.  avancer les cursors

Aucun échec post-commit autorisé.

------------------------------------------------------------------------

# 8. Versioning

## 8.1 Versioning d'événement

Chaque événement porte `schemaVersion`.

Évolution autorisée :

-   ajout de champs optionnels
-   dépréciation progressive
-   upcasting côté consumer si nécessaire

La lecture d'événements anciens doit rester possible.

------------------------------------------------------------------------

## 8.2 Versioning de la loi

Les MetaGraphVersion sont immuables et identifiées par
`meta.version.published`.

`ActiveMetaVersionId(metaSeq)` = dernier publish ≤ metaSeq.

------------------------------------------------------------------------

# 9. Compatibilité

## 9.1 Mutation Engine v1

-   Produit des transactions atomiques.
-   Valide sous loi pré-transaction.
-   N'écrit que des événements conformes à cette spécification.

## 9.2 Graph Runtime v1

-   Observe les deux streams.
-   Applique meta puis graph.
-   Maintient `(metaSeq, graphSeq)`.

## 9.3 Projection Engine v1

-   Projection = fonction(EventStream, LogicalSnapshot).
-   Projections reconstructibles.
-   Violations calculées côté projection.

------------------------------------------------------------------------

# 10. Open Questions

Aucune ouverte dans v1.

------------------------------------------------------------------------

# 11. Statut

Ce document définit le modèle canonique Event Model v1 de Mesh
Explorer.\
Il est cohérent avec :

-   séparation meta / graph
-   cursor composite
-   résolution automatique des refactors
-   contraintes forward-only
-   violations dérivées
-   replay déterministe

Version figée : 1.0

------------------------------------------------------------------------

## Source: command_intent_api_v\_1.md

# Command_Intent_API_v1.md

Version: 1.0\
Status: Normatif\
Scope: Contrat canonique **UI/API ↔ Kernel (Mutation Engine)** couvrant
**Intent → Command → Commit**, compatible avec **Event Model v1**,
**Mutation Engine v1**, **Overlay System v1.5**, **Permissions model**,
**Graph Runtime v1**.

------------------------------------------------------------------------

## 1) Objectifs formels de la Command API

### O1 --- Canon

Définir une **représentation unique** (Command) pour toute demande de
changement ontologique, quel que soit le client (UI, API externe,
migration runner).

### O2 --- Séparation des niveaux

Imposer la séparation stricte : - **Intent** = intention UI / produit
humain (non canonique, non commitée), - **Command** = requête canonique
exécutable par le noyau, - **Transaction/Events** = seul artefact
persistant du changement.

### O3 --- Compatibilité noyau

Garantir que l'exécution d'une Command respecte : - validation par type
(structurelle) - verrouillage pessimiste (pas de merge en v1) - commit
append-only EventStore (meta/graph streams)

### O4 --- Observabilité & déterminisme

Chaque Command doit produire : - soit un **receipt** stable, - soit une
**erreur normative** (codes, détails), sans effets partiels.

### O5 --- Idempotence & transport

Rendre les appels résilients (retry) via **idempotency key** et receipts
réutilisables.

------------------------------------------------------------------------

## 2) Distinction précise Intent vs Command

### 2.1 Intent (non canonique, côté UI/API edge)

**Intent** décrit *ce que l'utilisateur pense faire* (ou ce que l'UI
propose), avec contexte UI et éléments optionnels.

**Propriétés normatives :** - Peut contenir des références non stables
(sélections UI, drag/drop, "current view", objets overlay-local). - Peut
être **incomplète** (ex: "créer un lien ici" sans préciser
relationType). - N'a **aucune autorité** ontologique. - Ne doit
**jamais** être commitée telle quelle.

### 2.2 Command (canonique, exécutable noyau)

**Command** décrit *exactement* la requête exécutable : - doit être
**déterministe** à inputs égaux, - doit être **validable** (type
validation + permission), - doit être **idempotente** (par clé), - doit
permettre au noyau de produire une **Transaction** atomique (0..n
événements meta + 0..m événements graph) conforme Event Model v1.

### 2.3 Règle de transformation

Intent → Command est un processus **explicitement matérialisé**
(client-side ou gateway-side), qui : - résout les ambiguïtés (choix de
type/relation), - convertit les IDs overlay-local en références valides
(si commit overlay), - fixe le scope et l'actor.

------------------------------------------------------------------------

## 3) Schéma canonique d'une Command

### 3.1 Enveloppe Command (canonique)

``` json
Command {
  commandId: "uuid",
  idempotencyKey: "string",                 // obligatoire
  commandType: "graph.* | meta.* | overlay.*",
  schemaVersion: "1.0.0",

  actor: ActorRef,
  issuedAt: "ISO8601",

  scope: CommandScope,                      // voir 3.2
  targets: EntityRef[],                     // entités visées (best-effort; pour lock/impact)
  payload: object,                          // typé par commandType

  clientContext?: {
    clientId?: "string",
    requestId?: "string",
    uiSessionId?: "string"
  },

  preconditions?: {
    requireGraphCursor?: { metaSeq: int, graphSeq: int },  // optimistic guard optionnel
    requireOverlayStatus?: "draft"
  },

  batch?: {
    batchId: "uuid",
    index: int,
    total: int,
    atomic: true
  }
}
```

### 3.2 CommandScope (normatif)

Le scope fixe "où" la Command s'applique.

``` json
CommandScope {
  plane: "graph | meta | overlay",
  graphRef?: { cursor: { metaSeq: int, graphSeq: int } },
  metaRef?:  { metaSeq: int },
  overlayRef?: { overlayId: "string", baseGraphRevision: "..." }
}
```

**Règles :** 1. `plane` détermine la famille de Command. 2. `overlayRef`
est obligatoire pour `plane="overlay"`. 3. `graphRef.cursor` (si fourni)
sert de garde anti-staleness (optionnel en v1). 4. Aucun champ "view" /
"projection" n'est autoritatif (la vue n'est pas la vérité).

------------------------------------------------------------------------

## 4) Cycle de vie complet

Le Runtime reçoit une Command et la transmet au Kernel ; il n'invente
pas de validation métier.

### 4.1 Submit

`submitCommand(cmd) -> TransactionReceipt | CommandError`

### 4.2 Validate (structure)

Le Kernel valide structurellement selon les types (et leurs
schémas/contraintes locales).

### 4.3 Authorize

Le Kernel (ou un module d'autorisation appelé par lui) exécute :
`Authorize(subject, action, target, scope) -> allow | deny | mask`

### 4.4 Mutate

Si OK : - construction des Mutations, - constitution d'une Transaction
atomique.

### 4.5 Lock

Verrou pessimiste sur les entités ciblées le temps de la transaction.

### 4.6 Commit

Commit append-only dans l'EventStore en respectant l'ordre sémantique :
metaEvents puis graphEvents dans une même transaction (txId).

### 4.7 Receipt

Retour d'un receipt stable (voir §4.8). Le Runtime applique ensuite les
deltas en mémoire et notifie les projections ouvertes.

### 4.8 TransactionReceipt (normatif)

``` json
TransactionReceipt {
  commandId: "uuid",
  idempotencyKey: "string",

  status: "committed",
  txId: "string",

  committedAt: "ISO8601",
  cursorAfter: { metaSeq: int, graphSeq: int },

  eventRefs: {
    meta:  [{ seq: int, eventId: "string" }],
    graph: [{ seq: int, eventId: "string" }]
  },

  entityIdMap?: [
    { tempId: "OverlayLocalID | ClientTempID", realId: "GraphID", kind: "node|edge" }
  ],

  warnings?: [{ code: "string", message?: "string" }]
}
```

------------------------------------------------------------------------

## 5) Modèle d'erreurs normatif

### 5.1 Enveloppe CommandError

``` json
CommandError {
  commandId?: "uuid",
  idempotencyKey?: "string",

  status: "rejected",
  category: "VALIDATION | PERMISSION | CONFLICT | PRECONDITION | NOT_FOUND | INTERNAL",

  reasonCode: "string",
  message?: "string",
  details?: object,

  retryable: boolean,
  masked: boolean
}
```

### 5.2 VALIDATION

-   `CMD.VALIDATION.SCHEMA_MISMATCH`
-   `CMD.VALIDATION.MISSING_REQUIRED_FIELD`
-   `CMD.VALIDATION.TYPE_RULE_VIOLATION`
-   `META.*` si la validation remonte des codes meta.

**details.validationErrors\[\]** :

``` json
{ path: "payload.foo.bar", code: "string", expected?: "string", actual?: "string" }
```

### 5.3 PERMISSION

-   Codes **DENY.`<ACTION>`{=html}.`<TARGET>`{=html}.`<DETAIL>`{=html}**
-   `CMD.PERMISSION.MASKED`

**details** :

``` json
{ action: "update", targetRef?: "...", scope: {...} }
```

### 5.4 CONFLICT

-   `CMD.CONFLICT.LOCKED`
-   `CMD.CONFLICT.BUSY`

### 5.5 PRECONDITION

-   `CMD.PRECONDITION.CURSOR_MISMATCH`
-   `CMD.PRECONDITION.OVERLAY_STATUS_NOT_DRAFT`

### 5.6 NOT_FOUND

-   `CMD.NOT_FOUND.TARGET`
-   `CMD.NOT_FOUND.OVERLAY`

### 5.7 INTERNAL

-   `CMD.INTERNAL.ERROR`

------------------------------------------------------------------------

## 6) Idempotence et batching

### 6.1 Idempotence (normatif)

-   `idempotencyKey` est **obligatoire**.
-   Le serveur doit mémoriser l'association :
    `(actor, idempotencyKey) -> TransactionReceipt | CommandError final`
-   Toute répétition retourne **exactement** le même résultat.

**Règle dure :** Si une Command avec la même clé mais un payload
différent est reçue : - rejeter avec
`CMD.IDEMPOTENCY.KEY_REUSE_DIFFERENT_PAYLOAD`.

### 6.2 Batching (v1)

-   `batch.atomic = true` implique **une seule Transaction**
    (succès/échec atomique).
-   L'ordre d'application est `index` croissant.
-   En cas d'échec, aucune Command du batch n'est commitée.

------------------------------------------------------------------------

## 7) Invariants systémiques

### I1 --- Tout changement passe par mutation/transaction

Aucun write hors transaction ; aucune "action UI" n'est une mutation.

### I2 --- Validation par type

La validité structurelle est décidée par le contrat de type.

### I3 --- Pessimistic lock

Pas de merge concurrent en v1 ; le verrou protège le déterminisme.

### I4 --- EventStore append-only, deux streams

Commit produit des EventEnvelopes meta/graph conformes.

### I5 --- Ordre sémantique meta → graph intra-transaction

Le receipt doit refléter un `txId` complet ; aucun état partiel
admissible.

### I6 --- Vue ≠ vérité

Aucune projection/overlay/viewPreset n'est une autorité ; elles ne
servent qu'à dériver/preview.

### I7 --- Permission "mask" ne fuit pas l'existence

Si `mask`, l'erreur doit être indistinguable d'un NOT_FOUND côté
message, tout en gardant `masked=true` pour clients privilégiés.

### I8 --- Pas d'échec post-commit

Une fois commit, le Runtime applique et notifie ; pas de rollback "après
coup".

------------------------------------------------------------------------

## 8) Zones de tension Overlay / Event Model

### T1 --- IDs overlay-local vs IDs réels

Overlay introduit des `OverlayLocalID` jusqu'au commit. Le receipt doit
fournir une **table de mapping** `tempId -> realId`.

### T2 --- BaseGraphRevision vs Cursor global

Overlay référence `baseGraphRevision`, tandis que l'Event Model définit
un curseur `(metaSeq, graphSeq)`.

**Ambiguïté structurelle (à trancher) :** - Cas A ---
`baseGraphRevision` est équivalent à `graphSeq` (même espace
d'ordinalité) - Cas B --- `baseGraphRevision` est un identifiant de
snapshot distinct (pas directement comparable à `graphSeq`)

Impact : - A → precondition simple
`requireGraphCursor.graphSeq >= baseGraphRevision` - B → il faut une
fonction de correspondance snapshot→cursor (ou interdire le compare
direct)

### T3 --- Validation sous état logique pré-transaction

Le Kernel valide sous la loi "avant la transaction", puis commit, puis
le Runtime applique meta puis graph.

### T4 --- Contraintes forward-only

Les contraintes publiées n'empêchent pas le publish meta mais bloquent
les mutations futures non conformes.

Tension : un client peut "voir" une violation rétroactive en projection
sans que le graph soit invalide historiquement (signalement vs blocage).

### T5 --- Permissions et overlays

Commit overlay suit : OverlayDelta → Intent → PermissionCheck → Command
→ Validation → Commit.

Tension : permissions évaluées sur quoi exactement ? - sur les cibles
réelles (si déjà connues), - sur les créations (create) + updates
(update) + relations (traverse/commit), - avec masquage strict pour
éviter fuite via diff overlay.

------------------------------------------------------------------------

## Source: mutation_engine_v\_1.md

# Mutation Engine v1

## Ontologie de base

-   **Mutation = transaction atomique**
-   Toute modification du graph passe par une mutation
-   Une mutation est indivisible, traçable, rejouable

## Principe fondamental

Mutation ≠ action UI Mutation = fait ontologique

## Modèle conceptuel

### Mutation

``` txt
Mutation {
  id
  type
  payload
  targetEntities[]
  timestamp
  author
  status
}
```

### Transaction

``` txt
Transaction {
  id
  mutations[]
  atomic = true
}
```

------------------------------------------------------------------------

## ME-1 --- Nature

✔ Mutations atomiques ✔ Transactions composées possibles

------------------------------------------------------------------------

## ME-2 --- Validation

**Modèle choisi : A --- Validation par schéma (types uniquement)**

Règle :

> Une mutation est valide si et seulement si elle respecte le contrat du
> type.

### Implications

-   Pas de validation métier globale
-   Pas de validation topologique centrale
-   Le type est la seule autorité

``` txt
Type {
  schema
  constraints
  permissions
  invariants
}
```

Le type devient une loi locale.

------------------------------------------------------------------------

## ME-3 --- Conflits

**Modèle choisi : A --- Lock pessimiste**

Règle :

> Une entité ciblée par une mutation est verrouillée pendant la
> transaction.

### Implications

-   Conflit impossible
-   Pas de merge
-   Pas de résolution automatique
-   Pas de divergence

Système déterministe, sûr, simple.

------------------------------------------------------------------------

## ME-4 --- Atomicité

✔ Transaction atomique ✔ Rollback natif

------------------------------------------------------------------------

## ME-5 --- Scope

✔ Mutations locales ✔ Mutations multi-entités

------------------------------------------------------------------------

## ME-6 --- Persistences

✔ EventStore ✔ Log immuable

------------------------------------------------------------------------

## ME-7 --- Traçabilité

Type G sélectionné → historique complet, traçable, inspectable

------------------------------------------------------------------------

## ME-8 --- Interface

Type B → moteur interne, invisible, exposé via API

------------------------------------------------------------------------

# Architecture logique

``` txt
UI → Command
Command → Mutation
Mutation → Validation(type)
Validation OK → Lock
Lock → Commit EventStore
EventStore → Projection
Projection → GraphState
```

------------------------------------------------------------------------

# Lois du système

1.  Rien n'existe sans mutation
2.  Rien ne change sans transaction
3.  Rien n'est valide hors type
4.  Rien ne se modifie sans verrou
5.  Rien ne se perd (EventStore)

------------------------------------------------------------------------

# Propriétés émergentes

-   Déterminisme
-   Auditabilité
-   Réversibilité
-   Rejouabilité
-   Reproductibilité
-   Traçabilité totale

------------------------------------------------------------------------

# Compatibilité future

Le modèle permet évolution vers :

-   versioning
-   merge sémantique
-   validation composite
-   règles distribuées

sans casser la base.

------------------------------------------------------------------------

# Résumé

Le Mutation Engine devient :

> Un moteur de transformation ontologique atomique gouverné par les
> types sécurisé par verrouillage persisté par événements projeté par
> vues

Ce n'est pas un moteur d'actions. C'est un moteur de réalité.

------------------------------------------------------------------------

## Source: event_store_persistence_v\_1.md

# EventStore & Persistence Layer v1 (Mesh Explorer)

Version: 1.0\
Statut: Normatif\
Fichier: `EventStore_Persistence_v1.md`

------------------------------------------------------------------------

## 1. Objectifs formels

### P1 --- Source canonique de mémoire

La persistence layer **DOIT** persister intégralement l'historique sous
forme d'événements **append-only** conformes à l'Event Model v1.

### P2 --- Reconstructibilité déterministe

Pour tout curseur admissible `K = (metaSeq, graphSeq)`, la couche
**DOIT** permettre de reconstruire de manière déterministe : -
`MetaState(metaSeq)` - `GraphState(graphSeq)` sous
`LogicalSnapshot(K)` - toute projection (cache) dérivée à partir de
`(EventStream, LogicalSnapshot)`

### P3 --- Atomicité transactionnelle observable

La couche **DOIT** garantir l'invariant **tx-closed** : aucun
consommateur ne peut observer une transaction partielle.

### P4 --- Support runtime incrémental + recovery

La couche **DOIT** supporter : - lecture incrémentale par cursors
(Runtime) - boot rapide par snapshots non canoniques + replay partiel

### P5 --- Auditabilité & traçabilité

La couche **DOIT** permettre de : - retrouver un événement par
`eventId` - retrouver tous les événements d'une transaction par `txId` -
tracer l'impact (au minimum via `targetEntities[]` et `eventType`)

------------------------------------------------------------------------

## 2. Périmètre et compatibilité

### 2.1 Compatibilité normative

La présente spécification **DOIT** être compatible, sans modification de
leurs contrats, avec : - Event Model v1 (enveloppe, streams,
transactions, cursors) - Command / Intent API v1 (idempotence, receipts,
ordre meta→graph) - Mutation Engine v1 (transaction atomique, verrou
pessimiste) - Graph Runtime v1 (application meta puis graph, caches,
cursors) - Projection Engine v1 (reconstructible depuis EventStream +
LogicalSnapshot)

### 2.2 Non-duplication

Cette spécification ne redéfinit pas : - la forme de `EventEnvelope` -
le catalogue des `eventType` - les règles de validation/permissions Elle
fixe uniquement la **couche de persistance** (stockage, index,
snapshots, replay).

------------------------------------------------------------------------

## 3. Modèle conceptuel : EventStore

### 3.1 Instance et espace

Un EventStore est une instance **paramétrée par un espace de graphe**
(nommé ici `GraphSpace`). - Le mécanisme de sélection du `GraphSpace`
est **hors EventEnvelope** (contrainte de compatibilité). - Tous les
invariants ci-dessous s'appliquent **par GraphSpace**.

### 3.2 Streams

Conformément à l'Event Model v1, l'EventStore **DOIT** maintenir deux
streams append-only indépendants : - `meta` - `graph`

### 3.3 Unité persistée

L'unité persistée est l'`EventEnvelope` canonique. - L'EventStore
**DOIT** persister l'enveloppe complète, sans perte. - L'EventStore **NE
DOIT PAS** modifier un événement après commit.

### 3.4 Ordering

-   Chaque stream est **totalement ordonné** par `seq` strictement
    croissant.
-   Il n'existe **pas** d'ordre total inter-stream.

### 3.5 Transactions

Une transaction est identifiée par `txId`. - Les événements d'une
transaction peuvent exister sur `meta`, sur `graph`, ou sur les deux. -
Au sein d'une transaction, l'ordre sémantique est : `metaEvents`
précèdent `graphEvents`.

### 3.6 Invariant tx-closed (dur)

L'EventStore **DOIT** garantir : - **Atomic visibility** : si un
événement d'un `txId` est visible à la lecture, alors **tous** les
événements de ce `txId` (pour les streams concernés) le sont. - **No
partial cursor** : un curseur admissible ne représente jamais un état où
une transaction est partiellement visible.

Implémentation autorisée (non normative) : - marqueur de commit de
transaction - index transactionnel "complete/closed" - journal de commit
séparé

### 3.7 Immutabilité et append-only

-   L'EventStore **DOIT** être append-only au niveau logique.
-   Des optimisations physiques (segmentation, réécriture de segments,
    compression) sont **autorisées** si elles ne changent jamais le
    résultat logique des lectures.

------------------------------------------------------------------------

## 4. Partitioning

### 4.1 Partition minimale requise

L'EventStore **DOIT** partitionner au minimum par : - `GraphSpace` -
`stream` ∈ {`meta`, `graph`}

### 4.2 Partition optionnelle (scalabilité)

L'EventStore **MAY** partitionner physiquement davantage (sharding) si
: - l'ordre par `seq` est préservé **à l'intérieur** de chaque stream
logique - les lectures par `seq` restent déterministes

Note : si sharding, l'EventStore **DOIT** exposer une vue logique unique
par stream (la séquence observée reste strictement croissante).

------------------------------------------------------------------------

## 5. Index minimal requis

Les index ci-dessous sont **normatifs** : l'EventStore **DOIT** les
fournir (au sens "rendre possible les requêtes").

### 5.1 Index primaires

1)  **Par stream + seq** (lecture séquentielle)

-   Key: `(GraphSpace, stream, seq)` → `EventEnvelope`

2)  **Par eventId**

-   Key: `(GraphSpace, eventId)` → `(stream, seq)`

3)  **Par txId**

-   Key: `(GraphSpace, txId)` → `{ meta: [seq…], graph: [seq…] }` +
    `txClosed=true`

### 5.2 Index secondaires (minimum)

4)  **Par timestamp**

-   Key: `(GraphSpace, stream, timestamp)` → `[seq…]`

5)  **Par eventType**

-   Key: `(GraphSpace, stream, eventType)` → `[seq…]`

6)  **Par targetEntities**

-   Key: `(GraphSpace, stream, entityRef)` → `[seq…]`

Contraintes : - Les index secondaires peuvent être *eventually
consistent* en interne, **mais** toute lecture "cursor-based" utilisée
par le Runtime **DOIT** s'appuyer sur l'index primaire par `seq`.

------------------------------------------------------------------------

## 6. API normative (surface minimale)

Les signatures ci-dessous sont conceptuelles. Le transport (local, HTTP,
gRPC...) est hors scope.

### 6.1 Append / Commit

-   `appendTransaction(GraphSpace, txId, metaEvents[], graphEvents[]) -> cursorAfter`

Règles : - **MUST** attribuer `seq` conformément à l'Event Model v1. -
**MUST** rendre la transaction visible d'un seul bloc (tx-closed). -
**MUST** garantir l'unicité globale de `eventId`.

### 6.2 Read (par seq)

-   `readStream(GraphSpace, stream, fromSeqExclusive, limit) -> EventEnvelope[]`

Règles : - **MUST** retourner les événements en ordre croissant de
`seq`. - **MUST** ne jamais retourner une transaction partielle.

### 6.3 Read (par transaction)

-   `readTransaction(GraphSpace, txId) -> { metaEvents[], graphEvents[] }`

### 6.4 Lookup

-   `lookupByEventId(GraphSpace, eventId) -> EventEnvelope?`

### 6.5 Subscriptions (cursor-based)

-   `subscribe(GraphSpace, stream, fromSeqExclusive) -> iterator<EventEnvelope>`

Règles : - **MUST** préserver l'ordre par `seq`. - **MUST** préserver
tx-closed.

------------------------------------------------------------------------

## 7. Stratégie d'indexation (détails)

### 7.1 Règle centrale

Le Runtime et le replay canonique **DOIVENT** s'appuyer sur : - lecture
séquentielle par `seq` sur chaque stream

Les autres index servent : - aux inspections (audit) - à l'optimisation
(replay ciblé, projections impactées)

### 7.2 Index "impact"

L'index `entityRef -> seq[]` est requis pour : - accélérer les
stratégies d'impact de projections (ciblage par `targetEntities`) -
accélérer les inspections historiques (OIR / audit)

### 7.3 Index "type"

L'index `eventType -> seq[]` est requis pour : - filtrer des flux pour
des consumers spécialisés

------------------------------------------------------------------------

## 8. Snapshots (non canoniques)

### 8.1 Principe

Tout snapshot est un **accélérateur**, jamais une source de vérité. - Un
snapshot **DOIT** référencer exactement le curseur auquel il
correspond. - Un snapshot **DOIT** être invalidable et reconstructible
par replay.

### 8.2 Modèle canonique de référence

Un snapshot **DOIT** contenir : - `graphSpace` - `kind` - `cursorRef` -
`createdAt` - `formatVersion` - `checksum/digest`

### 8.3 Snapshots Meta (MetaState)

#### MetaSnapshot

``` txt
MetaSnapshot {
  graphSpace
  metaSeq
  metaVersionId?           // optionnel: dernier meta.version.published <= metaSeq
  serializedMetaState
  createdAt
  formatVersion
  digest
}
```

Règles : - **MUST** être cohérent avec `MetaState(metaSeq)`. - **MUST**
pouvoir être rejeté si `digest` invalide.

### 8.4 Snapshots Graph (GraphStateCache)

#### GraphSnapshot

``` txt
GraphSnapshot {
  graphSpace
  cursor: { metaSeq, graphSeq }
  serializedGraphState
  createdAt
  formatVersion
  digest
}
```

Règles : - **MUST** être interprété sous `LogicalSnapshot(cursor)`. -
**MUST** être rejeté si `metaSeq` \> curseur logique disponible lors du
boot.

### 8.5 Snapshots de projection

Conformes au principe Projection Engine v1 (cache matérialisé).

#### ProjectionSnapshot

``` txt
ProjectionSnapshot {
  graphSpace
  projectionSpecId
  logicalSnapshotRef: { metaSeq }
  eventCursor: { graphSeq }
  serializedProjectionCache
  createdAt
  formatVersion
  digest
}
```

Règles : - **MUST** être considéré invalide si `logicalSnapshotRef` ne
correspond pas au contexte de la projection (ou si invalidationReasons
existantes).

------------------------------------------------------------------------

## 9. Règles de replay et reconstruction

### 9.1 Boot (Runtime)

Le Runtime (ou un bootstrapper) **DOIT** suivre la stratégie : 1)
Charger le **dernier MetaSnapshot** disponible (sinon état initial). 2)
Rejouer `meta` depuis `metaSeqSnapshot` jusqu'au `metaSeqTarget`. 3)
Déterminer `LogicalSnapshot(metaSeqTarget)`. 4) Charger le **dernier
GraphSnapshot** compatible (sinon état initial). 5) Rejouer `graph`
depuis `graphSeqSnapshot` jusqu'au `graphSeqTarget`, en appliquant les
deltas sous `LogicalSnapshot(metaSeqTarget)`.

### 9.2 Reconstruction sans snapshots

Si aucun snapshot, la couche **DOIT** permettre : - replay complet
`meta` puis `graph` depuis `seq=0`.

### 9.3 Admissibilité des cursors

Un curseur `(metaSeq, graphSeq)` est admissible s'il respecte
tx-closed. - L'EventStore **DOIT** être capable de vérifier qu'un
curseur fourni n'est pas "au milieu" d'une transaction.

### 9.4 Règle d'ordre runtime (rappel de cohérence)

À chaque transaction observée : 1) appliquer `metaEvents` 2)
produire/mettre à jour `LogicalSnapshot` 3) appliquer `graphEvents` 4)
avancer les cursors

------------------------------------------------------------------------

## 10. Compaction et rétention

### 10.1 Principe

Le log est append-only au niveau logique. La compaction est
**physique**, pas sémantique.

### 10.2 Stratégies autorisées

L'EventStore **MAY** : - segmenter les logs (par ranges de `seq`) -
compresser les segments (ex: zstd) - fusionner des segments (LSM/merge)
sans changer les lectures - déplacer des segments anciens vers stockage
"cold"

### 10.3 Interdictions

L'EventStore **NE DOIT PAS** : - supprimer des événements nécessaires à
la reconstruction d'un curseur encore supporté - réécrire l'historique
de manière observable (changement de séquence, suppression logique)

### 10.4 Politique de rétention (optionnelle)

Une politique de rétention est **hors v1** tant qu'aucun mécanisme
canonique de "checkpoint de vérité" n'est défini. (Autrement dit : sans
définition d'un *cut* canonique, supprimer l'histoire revient à brûler
un livre et appeler ça de la littérature.)

------------------------------------------------------------------------

## 11. Gestion des cursors

### 11.1 Types de cursors

-   **Per-stream cursor** : `metaSeq` ou `graphSeq`
-   **Global cursor** : `K = (metaSeq, graphSeq)`

### 11.2 Tokens de reprise

La persistence layer **DOIT** permettre l'émission de tokens de reprise
stables (serialisables) pour : - consumers meta - consumers graph -
runtime global

Recommandation (non normative) :

``` txt
CursorToken {
  graphSpace
  stream?: meta|graph
  metaSeq
  graphSeq
  issuedAt
  signature?  // si multi-tenant
}
```

### 11.3 Checkpointing consumer

Un consumer **SHOULD** persister son dernier curseur traité (ack) de
façon idempotente. La persistence layer **MAY** fournir une table de
checkpoints par consumerId.

### 11.4 Cursor monotonicité

-   Un consumer **NE DOIT PAS** reculer son curseur par erreur (sauf
    opération explicite de rewind).
-   Un rewind explicite **MAY** être supporté pour debug/audit.

------------------------------------------------------------------------

## 12. Invariants systémiques

### I1 --- Append-only

Aucun événement ne change après commit.

### I2 --- Deux streams indépendants

`meta` et `graph` ont des séquences distinctes.

### I3 --- tx-closed

Aucune transaction partielle observable.

### I4 --- Déterminisme

À `K` fixé, la reconstruction est déterministe.

### I5 --- Séparation ontologique

-   GraphEvents = faits
-   MetaEvents = loi
-   Snapshots = caches
-   Violations = dérivés (jamais persistés)

### I6 --- Cohérence Runtime

Le Runtime applique meta puis graph, et n'écrit jamais dans
l'EventStore.

------------------------------------------------------------------------

## 13. Contraintes de cohérence avec le Runtime

### 13.1 Garanties nécessaires au Runtime

La persistence layer **DOIT** garantir : - lecture incrémentale "sans
trous" par `seq` - transactions observables comme unités closes - lookup
stable par `txId` et `eventId`

### 13.2 Ce que le Runtime ne doit pas faire

Le Runtime **NE DOIT PAS** : - réordonner les événements à l'intérieur
d'un stream - "inventer" des événements manquants - persister des
violations

------------------------------------------------------------------------

## 14. Résolution de révision d'overlay (baseGraphRevision)

### 14.1 Principe

`baseGraphRevision` est un identifiant de **snapshot/révision
matérialisée** distinct de `graphSeq`.

### 14.2 Fonction canonique

La persistence layer **DOIT** exposer une fonction canonique :

-   `resolveRevision(GraphSpace, baseGraphRevision) -> graphSeq`

Règles : - **MUST** retourner un `graphSeq` admissible (tx-closed). -
**MUST** échouer si `baseGraphRevision` est inconnu, invalide, ou non
résoluble dans le `GraphSpace`. - **MUST** être déterministe : à
identifiant identique, résultat identique.

### 14.3 Contraintes d'usage (cohérence Runtime)

-   Tout mécanisme (ex: overlay) qui exprime une précondition en termes
    de `baseGraphRevision` **MUST** passer par `resolveRevision` avant
    toute comparaison avec un curseur `graphSeq`.
-   Un snapshot référencé par `baseGraphRevision` **SHOULD** être ancré
    sur un curseur `(metaSeq, graphSeq)` persistant (au minimum
    `graphSeq`) afin de rendre `resolveRevision` calculable.

------------------------------------------------------------------------

## 15. Notes de mise en œuvre (non normatives)

-   Une architecture segmentée (log par ranges de `seq`) simplifie
    replay et compaction.
-   Un index "tx closed" explicite évite les cursors partiels.
-   Les index secondaires peuvent être dérivés en background tant que la
    lecture runtime s'appuie sur `(stream, seq)`.

------------------------------------------------------------------------

## Source: graph_runtime_v\_1.md

# GRAPH RUNTIME v1 --- Livrable

## Positionnement

> Le Graph Runtime est le **moteur d'exécution événementiel** qui tient
> le système en fonctionnement.
>
> Il ne change pas la physique (Kernel), n'invente pas les lois (Type
> Engine), et n'est pas une vue (Projection Engine).
>
> Il orchestre :
>
> -   l'application des transactions validées
> -   la mise à jour des états en mémoire
> -   la propagation des deltas vers les projections ouvertes
> -   le cycle de vie des snapshots et reconstructions

Modèle choisi : **événementiel** (pas de boucle continue).

------------------------------------------------------------------------

# Stratification (rappel)

## Niveau 0 --- Kernel (fixe)

-   validation structurelle
-   appel au validateur logique (interface)
-   lock pessimiste
-   commit EventStore

## Niveau 1 --- Type Engine / MetaGraph (mutationable)

-   ContextSpace
-   activation types/règles/priorités
-   validation logique

## Niveau 2 --- Graph métier

-   nodes, relations, types attachés

Le Runtime ne viole jamais :

-   atomicité
-   immutabilité de l'EventStore
-   séparation « vue ≠ vérité »

------------------------------------------------------------------------

# Objets gérés par le Runtime

``` txt
Runtime {
  kernel: KernelAPI
  eventStore: EventStoreAPI
  logicalStateProvider: LogicalStateProvider
  projectionEngine: ProjectionEngine

  graphState: GraphStateCache
  metaState: MetaStateCache

  projections: Map<ProjectionInstanceId, ProjectionInstance>

  cursors {
    graphEventCursor
    metaEventCursor
    globalEventCursor
  }
}
```

### GraphStateCache

-   cache en mémoire du plan métier
-   reconstructible
-   mis à jour par delta

### MetaStateCache

-   cache en mémoire du plan méta
-   contient l'état courant du ContextSpace + Type Engine
-   reconstructible
-   mis à jour par delta

------------------------------------------------------------------------

# Principe d'exécution

Le Runtime tourne sur un cycle simple :

1.  recevoir une transaction (ou un batch d'événements)
2.  s'assurer qu'elle est commitée (EventStore)
3.  appliquer les deltas en mémoire
4.  notifier les projections ouvertes

Aucune logique « en continu ».

------------------------------------------------------------------------

# Flux principal : Transaction → Effets

## 0) Entrée

Le Runtime reçoit soit :

-   une **Command** (UI/API) à passer au Kernel
-   ou une **Notification** de nouveaux événements (EventStore)

## 1) Soumission (si command)

``` txt
submitCommand(cmd) -> TransactionReceipt
```

Le Runtime ne valide pas. Il demande au Kernel d'exécuter.

## 2) Commit

Le Kernel commit dans l'EventStore (source de mémoire). Le Runtime
observe ensuite le commit.

## 3) Application en mémoire (delta)

``` txt
applyCommittedEvents(newEvents[])
  → split metaEvents vs graphEvents
  → applyMetaDelta(metaEvents)
  → applyGraphDelta(graphEvents)
  → update cursors
```

### Règle temporelle (effet différé)

Si la transaction contient des mutations du Type Engine, elles ne
s'appliquent qu'après commit. Le Runtime respecte cela en appliquant :

-   metaDelta
-   puis graphDelta

mais en conservant que la validation a été faite sous l'état logique
initial.

------------------------------------------------------------------------

# Gestion du LogicalSnapshot

## État logique courant

``` txt
LogicalSnapshot = { metaState at cursor C }
```

Le Runtime maintient :

-   un pointeur vers l'état logique courant (MetaStateCache)
-   un identifiant/cursor permettant de le référencer

## Contexte et validation

-   la validation logique est faite par le Kernel via l'interface du
    validateur
-   le Runtime expose l'état logique courant à des fins d'inspection et
    de projection

------------------------------------------------------------------------

# Projections : lifecycle et deltas

## Ouvrir une projection

``` txt
openProjection(specId, { contextOverride? }) -> ProjectionInstanceId
```

Le Runtime :

-   instancie une projection via le Projection Engine
-   lui associe :
    -   (EventCursor, LogicalCursor)
    -   un contexte effectif (override explicite ou défaut)

## Mise à jour d'une projection

``` txt
onEventsCommitted(newEvents[])
  → for each open projection:
       if impacted(projection, newEvents):
          projectionEngine.applyEventDelta(instance, relevantEvents)
       else:
          noop
```

## Invalidation / rebuild

``` txt
invalidateProjection(id, reason)
rebuildProjection(id, { fromSnapshot? })
```

Reasons typiques :

-   changement de LogicalSnapshot utilisé par la projection (si elle
    suit le défaut)
-   changement explicite de contexte override
-   corruption de cache / mismatch de cursor
-   migration de spec

------------------------------------------------------------------------

# Détection d'impact (impact graph)

Objectif : éviter de recalculer toutes les projections.

``` txt
impacted(projection, events) -> bool
```

Stratégies (combinables) :

-   par type d'événement (nodeAdded, relationAdded, etc.)
-   par ensemble d'entités touchées (targetEntities)
-   par index (ex: projection FS n'écoute que relationType=enfant)

------------------------------------------------------------------------

# Snapshots (non canoniques)

## Snapshots d'état en mémoire

-   GraphStateCache snapshot (accélération)
-   MetaStateCache snapshot (accélération)
-   ProjectionCache snapshots (accélération)

Règle :

-   jamais source de vérité
-   toujours invalidable
-   toujours reconstructible

------------------------------------------------------------------------

# Recovery / Boot

## Démarrage

``` txt
boot()
  → load latest snapshots (graph/meta)
  → read EventStore from snapshot cursor
  → applyCommittedEvents(replayEvents)
  → mark runtime ready
```

## Rebuild complet

``` txt
rebuildAll({ fromSnapshot? })
```

Cas :

-   mise à jour majeure de ProjectionSpec
-   changement majeur de Type Engine (migration)
-   corruption détectée

------------------------------------------------------------------------

# Incohérences rétroactives (projection)

Le Runtime ne bloque pas. Il expose des rapports produits par le
Projection Engine.

``` txt
getViolationReport(projectionId) -> ViolationReport[]
```

Le Runtime peut ensuite :

-   afficher
-   agréger
-   router vers l'UI

------------------------------------------------------------------------

# API minimale du Runtime

``` txt
submitCommand(cmd) -> receipt
sync() -> void  // rattrape les events commités
openProjection(specId, opts) -> projectionId
closeProjection(projectionId) -> void
invalidateProjection(projectionId, reason) -> void
rebuildProjection(projectionId, opts) -> void

getRuntimeStatus() -> { cursors, openProjections, logicalCursor }
getLogicalSnapshotRef() -> logicalCursor
getGraphStateRef() -> graphCursor
```

------------------------------------------------------------------------

# Garanties v1

-   **événementiel** : pas d'exécution continue
-   **déterministe** : à EventStore + LogicalSnapshot donnés
-   **non magique** : aucune mutation implicite
-   **séparation** : Kernel ≠ Runtime ≠ Projection
-   **performance** : deltas + snapshots
-   **multi-vues** : projections parallèles

------------------------------------------------------------------------

# Règles non négociables

1.  Le Runtime n'écrit jamais dans l'EventStore
2.  Le Runtime ne valide pas la logique
3.  Le Runtime ne produit pas de mutations « cachées »
4.  Toute modification passe par le Kernel
5.  Toute vue reste un cache dérivé

------------------------------------------------------------------------

# Résumé

Graph Runtime v1 = orchestration événementielle :

-   soumettre au Kernel
-   recevoir les commits
-   appliquer les deltas (meta puis graph)
-   tenir les caches en mémoire
-   nourrir les projections incrémentalement
-   reconstruire via snapshots + replay partiel

Le monde ne vit pas en continu. Il vit à chaque mutation. Et entre deux
mutations, il ne fait rien --- ce qui est exactement l'idée.

------------------------------------------------------------------------

## Source: identity_addressing_v\_1.md

# Identity & Addressing System v1 (Mesh Explorer)

Version: 1.0\
Status: Normatif\
Fichier: `Identity_Addressing_v1.md`

------------------------------------------------------------------------

## 0. Scope

Cette spécification définit le **système canonique d'identifiants et
d'adressage unifié** pour Mesh Explorer, couvrant :

-   Graph (nodes/edges réels)
-   MetaGraph (types, champs, relations, policies, invariants,
    contraintes)
-   Overlay (draft/hypothesis/annotation + objets overlay-locaux)
-   Derived (entités dérivées en projection)
-   Events / Transactions / Cursors (Event Model)

Elle est **strictement compatible** avec : - Event Model v1 - Command /
Intent API v1 - EventStore & Persistence v1 - Collaboration Model v1 -
Mutation Engine v1 - Type Engine v1 - Ontological Inspection Protocol

Cette spécification **ne redéfinit pas** les enveloppes d'événements, le
modèle de permission, ni les catalogues d'opérations. Elle fixe les
**règles d'identité** et d'**adressage** transverses.

------------------------------------------------------------------------

## 1. Objectifs formels du système d'identité

### I-OBJ1 --- Unicité adressable

Tout objet inspectable ou persistable (entité, événement, transaction,
overlay, dérivé, artefact méta) **DOIT** être référencé par un
identifiant ou une référence canonique.

### I-OBJ2 --- Non-ambiguïté inter-plans

Deux objets appartenant à des plans différents
(graph/meta/overlay/derived/event) **NE DOIVENT PAS** pouvoir entrer en
collision d'adressage.

### I-OBJ3 --- Compatibilité EventStore / replay

Les identifiants et références **DOIVENT** préserver : - la
reconstructibilité déterministe par replay, - la séparation
meta/graph, - l'invariant tx-closed.

### I-OBJ4 --- Sécurité non-fuyante

Le système d'adressage **NE DOIT PAS** obliger à révéler l'existence
d'objets masqués (mask). Toute surface qui expose une référence **DOIT**
pouvoir être filtrée/maskée sans fuite.

### I-OBJ5 --- Stabilité contrôlée

Les identifiants des objets canoniques (Graph, Meta, EventStore)
**DOIVENT** être stables selon les règles ci-dessous ; les identifiants
non canoniques (OverlayLocal, Derived) **DOIVENT** expliciter leur
scoping et leur provenance.

### I-OBJ6 --- Interopérabilité des moteurs

Les mêmes références **DOIVENT** être utilisables de manière cohérente
dans : - `targetEntities[]` des événements, - `targets[]` des Commands
(lock/impact), - l'inspection (OIR), - les projections (provenance
Derived).

------------------------------------------------------------------------

## 2. Concepts fondamentaux

### 2.1 Planes

Un identifiant appartient à un **plane** : - `graph` : réalité
ontologique (nodes/edges) - `meta` : loi
(types/relations/constraints/policies/invariants) - `overlay` :
modifications non ontologiques / annotations (avant commit) - `derived`
: entités calculées (projections) - `event` : événements, transactions,
cursors (EventStore)

Tout identifiant canonique **DOIT** être interprété avec un `plane`
explicite, soit par type statique (p.ex. `EventID`), soit par enveloppe
`Ref` (voir §4).

### 2.2 GraphSpace

Un `GraphSpace` est l'espace de partition minimal de l'EventStore
(multi-tenant / univers local). Tout adressage canonique vers EventStore
**DOIT** être scoped par `graphSpace`.

------------------------------------------------------------------------

## 3. Typologie des identifiants

### 3.1 Graph (canonique)

#### GraphNodeID

Identifiant stable d'un nœud réel.

-   Type : `string`
-   Scope : `graphSpace`
-   Unicité : globale dans un `graphSpace`
-   Stabilité : stable à vie (sauf suppression logique, voir §7)

#### GraphEdgeID

Identifiant stable d'une relation réelle.

-   Type : `string`
-   Scope : `graphSpace`
-   Unicité : globale dans un `graphSpace`
-   Stabilité : stable à vie

> Note : une relation est une entité ontologique à part entière ; son
> identité est indépendante du couple (from,to).

### 3.2 Meta (canonique)

Les objets MetaGraph sont adressables par des identifiants stables et/ou
par un chemin d'adressage stable (TargetPath).

#### MetaVersionID

Identifiant d'une version publiée du MetaGraph.

-   Type : `string`
-   Scope : `graphSpace`
-   Stabilité : immuable (une version publiée ne change pas)

#### TypeID

Identifiant stable d'un type.

-   Type : `string`
-   Scope : `graphSpace` (au minimum)
-   Stabilité : **DOIT** rester stable à travers les versions de
    MetaGraph

#### FieldID

Identifiant stable d'un champ dans un type.

-   Type : `string`
-   Scope : `(graphSpace, TypeID)`
-   Stabilité : **DOIT** rester stable à travers les versions (rename ≠
    new id)

#### RelationTypeID

Identifiant stable d'un type de relation.

-   Type : `string`
-   Scope : `graphSpace`
-   Stabilité : stable à travers les versions

#### PolicyID / ConstraintID / InvariantID / ModuleID

Identifiants stables des artefacts Meta.

-   Type : `string`
-   Scope : `graphSpace`
-   Stabilité : stable à travers les versions

#### MetaTargetPath

Adresse canonique stable d'un objet Meta au sein d'une version.

-   Type : `string` (format canonique, voir §5.2)
-   Exemples :
    -   `Type(<typeId>)`
    -   `Type(<typeId>).Field(<fieldId>)`
    -   `Relation(<relationTypeId>)`
    -   `Policy(<policyId>)`
    -   `Invariant(<invariantId>)`

Règle : un objet Meta sans identité stable **NE DOIT PAS** être
publiable, car il rend le diff/merge et les migrations fragiles.

### 3.3 Overlay (non canonique avant commit)

#### OverlayID

Identifiant d'un overlay.

-   Type : `string`
-   Scope : `graphSpace`
-   Stabilité : stable tant que l'overlay existe

#### OverlayLocalID

Identifiant local d'un objet créé dans un overlay avant commit.

-   Type : `string`
-   Scope : `(graphSpace, overlayId)`
-   Stabilité : stable dans l'overlay ; **NE DOIT PAS** être confondu
    avec un `GraphNodeID/GraphEdgeID`

#### BaseGraphRevision

Identifiant de révision/snapshot utilisé comme base de l'overlay.

-   Type : `string`
-   Scope : `graphSpace`
-   Résolution :
    `resolveRevision(graphSpace, baseGraphRevision) -> graphSeq`
    **MUST** exister au niveau persistence.

### 3.4 Derived (non canonique)

#### DerivedID

Identifiant d'une entité dérivée produite par une projection.

-   Type : `string`
-   Scope : `(graphSpace, projectionInstanceId)`
-   Stabilité : stable **au sein** d'une instance de projection tant que
    ses dépendances (eventCursor/logicalCursor/params) ne changent pas ;
    sinon invalidable.

Règle : tout `DerivedID` **DOIT** porter une provenance (voir §6.2).

### 3.5 Events / Transactions / Cursors (canonique)

#### EventID

Identifiant globalement unique d'un événement (EventEnvelope.eventId).

-   Type : `string`
-   Scope : `graphSpace`
-   Unicité : globale dans un `graphSpace`

#### TransactionID (TxID)

Identifiant d'une transaction atomique (EventEnvelope.txId).

-   Type : `string`
-   Scope : `graphSpace`

#### StreamSeq

Index strictement croissant dans un stream (`metaSeq` ou `graphSeq`).

-   Type : `integer`
-   Scope : `(graphSpace, stream)`

#### GlobalCursor

Curseur global : `(metaSeq, graphSeq)`.

-   Type : `{ metaSeq: int, graphSeq: int }`
-   Scope : `graphSpace`

#### TransactionIndex

Index dense d'un événement dans une transaction et un stream
(EventEnvelope.txIndex).

-   Type : `integer`
-   Scope : `(graphSpace, txId, stream)`

### 3.6 Session / Locks (éphémère)

#### SessionID

Identifiant d'une session de collaboration.

-   Type : `string`
-   Scope : `graphSpace`
-   Statut : éphémère (runtime)

#### LockID

Identifiant d'un lock.

-   Type : `string`
-   Scope : `graphSpace`
-   Statut : éphémère (runtime)

------------------------------------------------------------------------

## 4. Références canoniques (Ref) --- adressage unifié

### 4.1 Principe

Toute API ou artefact qui doit manipuler des identités de façon
polymorphe (Command.targets, Event.targetEntities, OIR.identity,
provenance Derived) **DOIT** utiliser des références typées.

### 4.2 EntityRef (noyau)

``` txt
EntityRef {
  graphSpace: string
  kind: "graph.node" | "graph.edge" | "meta" | "overlay" | "overlay.local" | "derived" | "event" | "tx" | "cursor"
  id: string

  // champs optionnels selon kind
  metaPath?: MetaTargetPath
  stream?: "meta" | "graph"
  seq?: integer
  cursor?: { metaSeq: int, graphSeq: int }
  overlayId?: string
  projectionInstanceId?: string
}
```

Règles : 1. `graphSpace`, `kind`, `id` **MUST** être présents. 2. `kind`
**MUST** permettre de distinguer sans ambiguïté le plan. 3. Pour
`kind="event"`, `stream` et `seq` **SHOULD** être présents si connus
(audit/lookup). 4. Pour `kind="meta"`, `metaPath` **MUST** être présent.
5. Pour `kind="overlay.local"`, `overlayId` **MUST** être présent. 6.
Pour `kind="derived"`, `projectionInstanceId` **MUST** être présent.

### 4.3 AddressRef (alias)

Un `EntityRef` est la forme canonique d'adressage. Toute forme textuelle
(URI-like) est optionnelle et non normative ; si exposée, elle **MUST**
être un pur encodage de `EntityRef` (pas de sémantique additionnelle).

------------------------------------------------------------------------

## 5. Règles de génération

### 5.1 Propriétés exigées

#### Unicité

-   `GraphNodeID`, `GraphEdgeID`, `EventID`, `TxID`, `OverlayID`,
    `MetaVersionID` **MUST** être uniques dans leur scope déclaré.

#### Stabilité

-   Les IDs canoniques **MUST NOT** être recyclés.
-   Les IDs overlay-local **MAY** être recyclés entre overlays
    différents, mais jamais au sein d'un même overlay.

#### Opaqueness

-   Les IDs sont **opaques, immuables et stables**.
-   Les consommateurs **MUST NOT** dériver de logique métier à partir de
    la forme interne d'un ID.
-   La spécification est **algorithm-agnostic** : elle ne mandate ni
    UUID, ni ULID, ni KSUID, ni aucun format particulier.
-   Toute implémentation **MAY** choisir un générateur arbitraire dès
    lors que les contraintes normatives d'unicité, de stabilité et
    d'immuabilité sont respectées.

### 5.2 MetaTargetPath (format canonique)

Le format du `MetaTargetPath` **MUST** être :

-   `Type(<TypeID>)`
-   `Type(<TypeID>).Field(<FieldID>)`
-   `Relation(<RelationTypeID>)`
-   `Policy(<PolicyID>)`
-   `Constraint(<ConstraintID>)`
-   `Invariant(<InvariantID>)`
-   `Module(<ModuleID>)`

Contraintes : 1. Les identifiants à l'intérieur des parenthèses **MUST**
être des IDs stables (pas de noms display). 2. Tout chemin **MUST** être
stable à travers les versions, sauf suppression explicite de la cible.

### 5.3 Déterminisme optionnel

Le système **MAY** générer certains identifiants de manière déterministe
(p.ex. `DerivedID` basé sur un hash) **UNIQUEMENT** si cela ne crée pas
de collisions et si le scope est explicite. Le choix d'algorithme est
hors scope.

------------------------------------------------------------------------

## 6. Relations entre identités (provenance et équivalences)

### 6.1 Equivalence et renvoi

Il existe deux relations fondamentales :

-   **RefersTo** : une référence pointe une autre identité (p.ex.
    Derived → Real).
-   **ResolvedBy** : une identité non canonique est résolue vers une
    identité canonique (p.ex. OverlayLocalID → GraphID à commit).

### 6.2 Provenance (obligatoire pour Derived)

Toute entité dérivée **MUST** porter une provenance minimale :

``` txt
Provenance {
  kind: "derived"
  producedBy: { projectionSpecId, projectionInstanceId }
  inputs: {
    graphSpace
    eventCursor: { graphSeq: int }
    logicalSnapshotRef: { metaSeq: int }
    paramsHash: string
  }
  sourceRefs: EntityRef[]   // au minimum: nœuds/arêtes réels impliqués si disponibles
}
```

Contraintes : 1. `logicalSnapshotRef` **MUST** être explicite (sinon
dérivé non reproductible). 2. `sourceRefs` **MAY** être partiel
(best-effort) mais **MUST NOT** être vide si la dérivation prétend
"représenter" une entité réelle.

### 6.3 Mapping OverlayLocal → Real (commit)

Lors d'un commit overlay, le receipt **MUST** produire une table
`tempId → realId` pour chaque création.

Cette table : - **MUST** être exhaustive pour les créations, - **MUST**
permettre de re-référencer les événements graph produits, - **MUST**
être utilisable pour réconcilier UI (sélections, inspections) avec le
Graph.

### 6.4 Références Meta à travers migrations

Les refactors Meta (rename/split/merge/deprecate) **MUST** conserver la
résolubilité des références.

Règles : 1. Un rename **MUST** préserver l'ID stable
(TypeID/FieldID/etc.). 2. Un split/merge **MUST** fournir une table de
mapping `oldRef → newRef` inspectable. 3. Une suppression finale
**MUST** être précédée d'une migration explicite si des références ou
instances existent.

------------------------------------------------------------------------

## 7. Scoping et espaces de noms

### 7.1 Scope minimal par plan

#### Principe canonique

Le scope canonique d'identité est le `GraphSpace`.

-   Tous les IDs canoniques **MUST** être uniques à l'intérieur de leur
    `GraphSpace`.
-   La spécification **N'IMPOSE PAS** d'unicité globale
    inter-GraphSpace.
-   Une unicité inter-GraphSpace ne peut exister que si une couche de
    fédération explicite la définit.

#### Scopes par plan

-   Graph : `(graphSpace)`
-   Meta : `(graphSpace, metaVersionId?)` pour lecture historique ; les
    IDs eux-mêmes sont stables au-delà des versions mais restent uniques
    dans leur `graphSpace`
-   Overlay : `(graphSpace, overlayId)`
-   Derived : `(graphSpace, projectionInstanceId)`
-   Event/Tx/Cursor : `(graphSpace, stream?)`

### 7.2 Règle de non-collision

Un identifiant **NE DOIT PAS** être interprété sans son type (ou son
`kind`).

Conséquence : - Les APIs polymorphes **MUST** utiliser `EntityRef`. -
Les structures monomorphes **MAY** accepter un ID nu si le type est
garanti par le schéma (ex : `graph.node.added.nodeId`).

### 7.3 Namespace logique (recommandé)

Le système **SHOULD** exposer, pour debug et inspection, un namespace
logique basé sur `kind` (p.ex. `graph.node`, `meta.type`, `event`,
etc.). Ce namespace est un mécanisme d'adressage, pas une permission.

------------------------------------------------------------------------

## 8. Contraintes liées aux migrations Meta

### 8.1 Principe

Une migration Meta modifie la loi ; elle **NE DOIT PAS** casser
silencieusement la capacité de : - relire l'historique, - rejouer les
événements, - inspecter les références.

### 8.2 Invariants de migration d'identité

1.  Les IDs stables (TypeID, FieldID, RelationTypeID, PolicyID,
    ConstraintID, InvariantID) **MUST** rester stables à travers les
    versions.
2.  Les changements "dangereux" **MUST** être exprimés comme refactors
    résolubles (avec mapping).
3.  Toute version publiée **MUST** être adressable par `MetaVersionID`
    et inspectable.

### 8.3 Résolution rétroactive

Pour inspection d'un événement historique, la couche d'inspection
**MUST** pouvoir : - afficher la cible Meta par `MetaTargetPath`
(stable), - et, si nécessaire, contextualiser l'affichage selon la
version active au `metaSeq` inspecté.

------------------------------------------------------------------------

## 9. Invariants systémiques

### INV-1 --- Identité technique

L'identité est technique : elle ne porte pas de sens métier. Le sens est
porté par les relations et les types.

### INV-2 --- Append-only

Les IDs des événements et transactions ne changent jamais après commit.

### INV-3 --- Tx-closed

Tout adressage par curseur/seq **MUST** respecter l'invariant tx-closed
(pas d'état partiel).

### INV-4 --- Overlay isolant

Un `OverlayLocalID` n'est jamais une vérité ontologique ; il n'existe
comme identité qu'à l'intérieur de son overlay.

### INV-5 --- Derived traçable

Un `DerivedID` sans provenance est une erreur d'inspection et **MUST**
être traité comme invalide.

### INV-6 --- Sécurité non fuyante

Aucun mécanisme d'adressage (lookup, résolution, erreurs) **MUST**
révéler l'existence d'une cible masquée.

------------------------------------------------------------------------

## 10. Risques structurels évités par le design

### R1 --- Collisions inter-plans

Évité par : `kind` explicite + scopes + `EntityRef`.

### R2 --- Merge/diff méta fragile

Évité par : IDs méta stables + `MetaTargetPath` + interdiction d'objets
publiés sans ID stable.

### R3 --- Fuites de sécurité via erreurs d'adressage

Évité par : compatibilité `mask` + interdiction d'exposer des détails
d'owner/locks sur cibles masquées.

### R4 --- Projections non reproductibles

Évité par : provenance obligatoire (logical snapshot + cursors +
paramsHash).

### R5 --- Overlay impossible à committer proprement

Évité par : séparation OverlayLocalID vs GraphID + mapping receipt +
résolution canonique de `baseGraphRevision`.

### R6 --- Migrations qui "cassent l'histoire"

Évité par : stabilité des IDs méta + refactors résolubles avec mapping +
versions publiées adressables.

------------------------------------------------------------------------

## 11. Annexes (schémas minimaux)

### 11.1 Identifiants principaux

``` txt
GraphNodeID: string
GraphEdgeID: string
TypeID: string
FieldID: string
RelationTypeID: string
PolicyID: string
ConstraintID: string
InvariantID: string
MetaVersionID: string
OverlayID: string
OverlayLocalID: string
DerivedID: string
EventID: string
TxID: string
GlobalCursor: { metaSeq: int, graphSeq: int }
```

### 11.2 Référence canonique

``` txt
EntityRef = { graphSpace, kind, id, ... }
```

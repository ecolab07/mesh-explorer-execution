# Mesh Compliance Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: conformance_test_model_v\_1.md

# Conformance Test Model v1
Version: 1.0  
Status: Normatif  
Fichier: `Conformance_Test_Model_v1.md`

---

## 0. Scope
Ce document définit le **modèle canonique de tests de conformité** garantissant qu’une implémentation Mesh Explorer respecte les invariants systémiques déjà spécifiés (Event Model, Command API, Persistence, Collaboration, Identity, Workspace, Import/Export, Sync, Type Engine, Projection Engine, Overlay, View System, Permissions, etc.).

Ce document :
- **ne redéfinit pas** les spécifications existantes ;
- définit **ce qui doit être vérifiable** et **comment** (oracles, fixtures, classification) ;
- vise des tests **automatisables** et **reproductibles**.

---

## 1. Objectifs formels du modèle de conformité

### CT-OBJ1 — Vérifiabilité des invariants
Le système **DOIT** fournir (par API de test, hooks ou instrumentation) les observables nécessaires pour vérifier les invariants sans introspection non canonique.

### CT-OBJ2 — Déterminisme reproductible
Pour des entrées identiques (Commands/Events/Params/LogicalSnapshot refs), l’implémentation **DOIT** produire des sorties identiques (receipts, reconstruction, projections), modulo champs explicitement non déterministes (timestamps, ids générés) qui doivent être isolés par des règles de normalisation de test.

### CT-OBJ3 — Robustesse face aux retries et duplications
Le système **DOIT** rester correct sous :
- retries de submit (idempotence),
- redélivrance d’events (at-least-once),
- reconnexions (resume par cursor).

### CT-OBJ4 — Sécurité non-fuyante
Les surfaces testées (Command errors, locks, sync/events, inspection) **NE DOIVENT PAS** fuiter l’existence de cibles masquées.

### CT-OBJ5 — Couverture couche-par-couche + bout-en-bout
La conformité **DOIT** être prouvée via :
- tests par couche (contracts),
- tests d’intégration (pipelines),
- tests de non-régression (golden + snapshots normalisés).

---

## 2. Invariants globaux à tester (liste normative)

Chaque invariant ci-dessous **DOIT** avoir au minimum un test **Critical** (voir §9) et un test **Structural** (sauf mention).

### I-01 — Séparation ontologique
- Vue/Projection/Overlay/Snapshot **≠** autorité ontologique.

### I-02 — Append-only & immutabilité post-commit (EventStore)
- Aucun événement n’est modifié après commit.

### I-03 — Deux streams `meta` / `graph`
- Ordre total **par stream**, pas d’ordre total inter-stream.

### I-04 — Transactions atomiques visibles (tx-closed)
- Aucun consumer n’observe une transaction partielle.

### I-05 — Ordre sémantique intra-transaction : meta → graph
- Toute application/replay respecte meta puis graph.

### I-06 — Déterminisme par replay à curseur admissible
- Reconstruction MetaState / GraphState / projections déterministes.

### I-07 — Non-magie (writes explicites uniquement)
- Toute modification canonique passe Command → Kernel → Transaction → EventStore.

### I-08 — Validation structurée par types (commit-time)
- Rejets/acceptations au commit suivent le contrat.

### I-09 — Pessimistic locking v1
- Pas de merge concurrent : contention = reject.

### I-10 — Idempotence des Commands
- Même `(actor, idempotencyKey, payload)` ⇒ même résultat final.

### I-11 — Sécurité `allow | deny | mask` non-fuyante
- `mask` ne fuit pas l’existence (contenu/erreurs/locks/sync).

### I-12 — Deny-wins sur conflits de permissions (merge meta)
- Toute résolution de conflit de policies suit le moindre privilège.

### I-13 — Snapshots non canoniques
- Invalidables, reconstructibles, jamais source de vérité.

### I-14 — Adressage unifié par plane + scope
- `EntityRef` (ou équivalent) évite collisions inter-plans.

### I-15 — `baseGraphRevision` résolue canoniquement
- Comparaisons passent par `resolveRevision`.

---

## 3. Artefacts et primitives de test (normatifs)

### 3.1 Test Workspace (GraphSpace)
Tout run de conformité **DOIT** s’exécuter dans un **Workspace/GraphSpace isolé** (ne contenant aucun état non contrôlé).

### 3.2 Seed et normalisation
Le harness **DOIT** permettre :
- une graine pseudo-aléatoire fixée (tests génératifs),
- une normalisation des sorties pour ignorer les champs explicitement non déterministes.

#### Contrat normatif de normalisation (v1)
Les tests de conformité **DOIVENT** comparer des sorties **normalisées**.
- Les IDs sont **opaques** : un test **MUST NOT** dépendre d’un format (UUID/ULID/KSUID…).
- Les timestamps et champs temporels **DOIVENT** être neutralisés (ex. `T0+Δ`) ou comparés par propriétés (parseable, monotones si requis), jamais par valeur exacte.
- Les collections non ordonnées **DOIVENT** être canonisées (tri stable) avant comparaison.
- Si une comparaison inter-runs requiert l’alignement d’IDs générés, le harness **DOIT** appliquer un mapping stable par ordre de première apparition (ex. `ID#1`, `ID#2`, …).
- Les erreurs/receipts **DOIVENT** être comparés par **reason codes** et structure, pas par messages humains.

Normalisation minimale (exemples) :
- timestamps → remplacés par `T0+Δ`
- IDs générés → remplacés par placeholders stables via table de mapping de test.

### 3.3 Oracles de conformité
Un test conforme **DOIT** s’appuyer sur au moins un oracle de type :
- **Oracle A (Receipt/Errors)** : comparaison structurelle de receipts et codes.
- **Oracle B (Replay)** : reconstruction depuis EventStore et comparaison d’états normalisés.
- **Oracle C (Projection)** : comparaison de ViewModels / caches normalisés.
- **Oracle D (Security)** : comparaison d’observables visibles vs interdits (absence de fuite).

### 3.4 Observabilité minimale requise
L’implémentation **DOIT** fournir (en mode test) l’accès contrôlé aux observables suivants :
- lecture EventStore par `(stream, seq range)` et par `txId`
- inspection du caractère **tx-closed** d’un cursor (ou refus de cursors partiels)
- exécution de replay boot (avec ou sans snapshots)
- ouverture/rebuild de projections (avec contexte/logicalSnapshot explicite)
- exécution d’import/export (package snapshot) dans un workspace vide
- surfaces Sync (poll/read/subscribe ou équivalents)

---

## 4. Stratégie de test par couche (normative)

### 4.1 Command / Mutation (Kernel)
Le système **DOIT** fournir des tests contractuels pour :

1) **Idempotence stricte**
- Submit même Command (même actor + idempotencyKey + payload) N fois ⇒ résultat final identique.
- Réutilisation d’une idempotencyKey avec payload différent ⇒ rejet normatif.

2) **Aucun effet partiel**
- En cas de rejet (validation/permission/precondition/conflict), **aucun événement** nouveau n’est visible.

3) **Lock pessimiste**
- Deux Commands concurrentes sur mêmes targets : exactement une commit, l’autre rejet `CONFLICT`.

4) **Preconditions**
- Si une Command impose une précondition de cursor et qu’elle échoue : rejet `PRECONDITION` + pas d’effets.


### 4.2 EventStore / Replay
La persistence layer **DOIT** passer :

1) **Append-only**
- Toute lecture d’un événement déjà commit renvoie un payload identique (normalisé).

2) **tx-closed**
- Toute API de lecture cursor-based ne retourne jamais une transaction partielle.
- Tout cursor “au milieu” d’une transaction est :
  - soit impossible à produire,
  - soit explicitement rejeté par l’API.

3) **Replay déterministe**
- Rebuild complet sans snapshots == Rebuild via snapshots + replay partiel (équivalence d’état normalisé).


### 4.3 Runtime
Le runtime **DOIT** être testé sur :

1) **Orchestration sans écriture**
- Le runtime n’écrit pas dans l’EventStore ; seules les Commands le font via Kernel.

2) **Application meta→graph**
- Après commit d’une transaction mixte, l’application en mémoire et la notification aux projections respectent meta puis graph.

3) **Cursors monotones**
- Les cursors runtime avancent monotoniquement et restent admissibles.


### 4.4 Projection
Le projection engine **DOIT** satisfaire :

1) **Pureté**
- Une projection n’écrit jamais dans le Graph / EventStore.

2) **Déterminisme conditionnel**
- À `(EventStream, LogicalSnapshot, Params)` identiques ⇒ résultat identique (normalisé).

3) **Équivalence incremental vs rebuild**
- À partir d’un même état initial :
  - appliquer deltas incrémentaux
  - vs rebuild complet
  ⇒ donne le même résultat (normalisé).


### 4.5 Permissions / Mask
Le système **DOIT** tester :

1) **Deny vs Mask**
- `deny` : visible mais interdit, reason codes conformes.
- `mask` : réponse extérieure indistinguable d’un NOT_FOUND (selon les surfaces) et **aucune fuite** d’existence.

2) **Non-fuite via locks**
- Une cible masquée ne doit jamais permettre d’inférer “locked by X / exists”.

3) **Non-fuite via inspection**
- Toute inspection doit respecter le masquage (pas d’OIR révélateur).


### 4.6 Import / Export
L’implémentation **DOIT** tester :

1) **Export = snapshot à curseur K**
- Le package contient un état reconstructible.

2) **Import dans workspace vide uniquement (v1)**
- Import dans workspace non vide : rejet normatif.

3) **Import via Commands**
- L’import ne doit pas écrire directement EventStore.
- L’état final est équivalent au package (normalisé), et le cursor final est tx-closed.


### 4.7 Sync
La Sync layer **DOIT** prouver :

1) **Submit transport → receipt canonique**
- Acks transport ≠ commit ; seul receipt final fait foi.

2) **Events : at-least-once + dédup**
- Redelivery d’events ne change pas l’état local du client (idempotence par eventId).

3) **Cursors par visibilité (si applicable)**
- Aucun “trou” observable dû au masking.
- Le client ne peut pas dériver l’existence d’événements/entités non visibles.

4) **Contrat normatif “visibility-safe cursor”**
- Tout cursor/seq/token exposé à un client **DOIT** être **non-fuyant** dans son contexte de visibilité.
- Un test **MUST NOT** exiger que le cursor client reflète un `graphSeq` global si cela créerait une fuite sous `mask`.
- La conformité “mask + sync” **DOIT** être prouvée par un oracle d’**indistinguabilité** :
  - Scénario A : cible absente
  - Scénario B : cible existante mais masquée
  - Observables côté client non privilégié (erreurs, shapes, events, metadata, cursors, timings dans les bornes autorisées) **DOIVENT** être indistinguables (ou appartenir à une classe explicitement indifférenciée).

---

## 5. Modèle de test replay (EventStream → Snapshot → Projection determinism)

### 5.1 Définition de l’expérience
Pour un GraphSpace et un scénario S :
1) Produire une suite de Commands canonique `C1..Cn`.
2) Capturer les receipts et le cursor final `K`.
3) Extraire les événements `M≤metaSeq(K)` et `G≤graphSeq(K)`.
4) Exécuter deux reconstructions :
   - **R1** : replay complet (sans snapshots)
   - **R2** : snapshots (meta+graph) + replay partiel
5) Ouvrir une projection P (params + logical snapshot refs explicités) et comparer les sorties :
   - **P1** depuis R1
   - **P2** depuis R2
6) Vérifier : `State(R1) == State(R2)` et `Projection(P1) == Projection(P2)` après normalisation.

### 5.2 Exigences normatives
- Le harness **DOIT** fixer explicitement le logical snapshot utilisé (metaSeq) lors des reconstructions.
- L’équivalence de reconstruction **DOIT** être définie sur :
  - `MetaState(metaSeq)`
  - `GraphState(graphSeq)` **sous** `LogicalSnapshot(metaSeq)`
  après canonicalisation/normalisation.
- Toute comparaison impliquant `baseGraphRevision` **DOIT** passer par `resolveRevision(baseGraphRevision) -> graphSeq` avant vérification d’équivalence.
- Tout écart **DOIT** être reporté comme violation **Critical**.

---

## 6. Golden tests pour projections

### 6.1 Définition
Un **golden test** associe :
- un dataset de base (créé par Commands ou import package),
- une ProjectionSpec + params,
- un résultat attendu **normalisé** (golden).

### 6.2 Règles
- Les goldens **DOIVENT** être versionnés avec :
  - la version de la spec de projection,
  - le metaSeq/logical snapshot attendu,
  - la stratégie de normalisation.

- Toute modification de golden **DOIT** être explicitée (change log) et classée au minimum en **Regression**.

### 6.3 Minimaux recommandés (v1)
- projection ne produisant que Real nodes/edges
- projection produisant des Derived avec provenance
- projection consommant overlay view (OverlayGraphView)

---

## 7. Tests de sécurité (deny-wins, absence de fuite sous mask)

### 7.1 Suites minimales
Le système **DOIT** inclure des suites qui tentent d’inférer l’existence d’une entité masquée via :
- différences d’erreurs (NOT_FOUND vs LOCKED vs PERMISSION)
- différences de shape (présence/absence de champs)
- différences de cursors (trous, sauts non expliqués)
- différences de payload d’events (targetEntities révélatrices)

### 7.2 Règle d’oracle
Le test est **réussi** si, pour deux scénarios :
- A : cible absente
- B : cible existante mais masquée
les observables côté client non privilégié sont **indistinguables** (ou dans un ensemble explicitement autorisé comme indistinguable).

### 7.3 Deny-wins (Meta merge)
Quand deux changements de policy entrent en conflit, la résolution **DOIT** choisir le moindre privilège. Des tests **DOIVENT** vérifier :
- ouverture vs fermeture ⇒ fermeture gagne
- allow vs deny ⇒ deny gagne
- allow vs mask ⇒ mask gagne (si modèle prévoit mask comme plus strict)

---

## 8. Tests de transactions fermées (tx-closed strict)

### 8.1 Propriété à vérifier
Toute API de lecture cursor-based utilisée par runtime/sync **DOIT** :
- livrer la transaction entière ou rien,
- ne jamais livrer un préfixe d’une transaction.

### 8.2 Tests minimaux
1) **Lecture par ranges** : en demandant des ranges qui coupent une transaction, l’API doit :
- soit ajuster le résultat pour rester tx-closed,
- soit refuser la requête.

2) **Subscribe / Poll** : aucune notification ne doit contenir une transaction partielle.

3) **Cursor admissible** : toute production de cursorAfter doit être admissible.

---

## 9. Stratégie de tests de migration Meta

### 9.1 Objectif
Prouver que les évolutions Meta (publish, refactors résolubles, migrations explicites) respectent :
- stabilité des IDs meta,
- résolubilité des références,
- non-casse silencieuse (compatibilité / migration plan).

### 9.2 Suites minimales
1) **Publish meta + replay**
- Un publish produit une version inspectable et stable au replay.

2) **Refactor résoluble obligatoire**
- Toute opération déclarée refactor **DOIT** fournir une résolution/mapping.
- Un refactor non résoluble **DOIT** échouer au commit.

3) **Compatibilité Graph**
- Pour un changement “WithMigration” :
  - génération d’un MigrationPlan
  - dry-run
  - exécution via Commands
  - état final conforme

4) **Forward-only constraints**
- Une contrainte publiée ne doit pas invalider rétroactivement l’histoire ; elle doit bloquer uniquement les mutations futures non conformes.

---

## 10. Classification des tests (Critical / Structural / Regression)

### 10.1 Critical
Tests dont l’échec détruit la cohérence ou la sécurité du système.

Obligatoires :
- tx-closed strict (EventStore + Sync)
- meta→graph intra-transaction (runtime + client application)
- idempotence des Commands
- non-fuite sous mask (erreurs/locks/sync)
- replay déterministe (sans snapshots vs avec snapshots)

### 10.2 Structural
Tests qui prouvent les propriétés d’architecture et de contrats, sans être forcément catastrophiques à court terme, mais indispensables pour maintenir le design.

Exemples :
- séparation vue ≠ vérité
- absence de writes runtime/projection
- adressage unifié (pas de collision inter-plans)
- overlay commit strict (preconditions)

### 10.3 Regression
Tests stables à long terme, orientés non-régression :
- golden projections
- scénarios import/export
- compat/migration meta

---

## 11. Matrice minimale de conformité (v1)

Une implémentation est **Conformant v1** si, au minimum :

1) Tous les tests **Critical** passent.
2) Au moins un test **Structural** couvre chaque invariant I-01..I-15.
3) Les suites **Security** couvrent au moins :
   - Command errors
   - Locks
   - Sync events
4) Au moins un golden test existe par famille de projection (Real-only, Derived, OverlayGraphView).

---

## 12. Output et traçabilité

### 12.0 Canonical State Dump (oracle d’équivalence)
Lorsqu’un test requiert l’égalité d’état (replay vs snapshot+replay, import vs état attendu, etc.), le harness **DOIT** comparer des dumps **canonisés**.

Un CanonicalStateDump **DOIT** :
- sérialiser les tables/collections pertinentes avec un **ordre stable** (tri canonique),
- canoniser l’ordre des clés (stable) et des collections non ordonnées,
- neutraliser les champs non déterministes (cf. §3.2),
- exclure les artefacts non autoritatifs (caches, outputs temporaires), sauf si le test porte explicitement sur eux.

### 12.1 Rapport de run
Chaque run **DOIT** produire un rapport machine-readable :
- version système (build)
- graphSpaceId de test
- seed
- liste des tests, statut, durée
- mapping `TestCase → Invariant(s)`
- artefacts attachés : receipts, ranges d’events, dumps normalisés, diffs.

### 12.2 Reason codes
Les tests qui valident des rejets **DOIVENT** vérifier les reason codes attendus (validation/permission/conflict/precondition) sans dépendre d’un message humain.

---

## 13. Résumé
Le Conformance Test Model v1 transforme les invariants en obligations testables :
- oracles (receipt/replay/projection/security)
- suites par couche + bout-en-bout
- replay déterministe
- goldens projections
- sécurité non-fuyante
- tx-closed strict
- migrations meta
- classification Critical/Structural/Regression

L’objectif n’est pas de tester “tout”, mais de rendre l’architecture **vérifiable** et donc durable.

------------------------------------------------------------------------

## Source: observability_auditability_v\_1.md

# Observability\_Auditability\_v1

Version: 1.0\
Status: Normatif

---

## 0. Scope

Cette spécification définit le **modèle canonique d’observabilité et d’audit** de Mesh Explorer afin de rendre le système **inspectable, traçable et diagnostiquable** en production.

Elle est **strictement compatible** avec :

- Event Model v1 (EventEnvelope, streams `meta/graph`, invariant `tx-closed`, ordre sémantique `meta → graph`)
- Command / Intent API v1 (Command, TransactionReceipt, CommandError)
- EventStore & Persistence v1
- Graph Runtime v1
- Projection Engine v1
- Sync / Transport Layer v1
- Permissions model (`allow | deny | mask`)

Cette spécification **ne redéfinit pas** ces modèles : elle définit **les observables**, **les identifiants de corrélation**, **les journaux d’audit**, **les métriques**, et **les invariants** permettant d’inspecter les flux end-to-end.

---

## 1. Objectifs formels de l’observabilité

### OA-OBJ1 — Traçabilité bout-en-bout

Tout flux de changement (Intent→Command→Commit→Replay→Projection→Sync) **MUST** être traçable via un graphe de corrélations explicite.

### OA-OBJ2 — Inspectabilité sans introspection non canonique

Le système **MUST** exposer des surfaces d’inspection contrôlées permettant d’expliquer un état, un rejet, un retard, ou une divergence **sans** lire/patcher des structures internes non contractuelles.

### OA-OBJ3 — Diagnostic déterministe

Pour une entrée donnée (Command + cursor + contexte), le système **MUST** pouvoir produire un diagnostic reproductible :

- provenance des décisions (validation, permissions, locks, preconditions)
- provenance des sorties (txId, eventIds, cursors)
- explication des invalidations/rebuilds de projections

### OA-OBJ4 — Sécurité non-fuyante de l’observabilité

Les surfaces d’observabilité et d’audit **MUST** respecter `allow | deny | mask` et **MUST NOT** introduire de fuite d’existence (notamment via : erreurs, locks, métriques scindées, traces trop détaillées, “not found” différenciés).

### OA-OBJ5 — Audit exploitable

L’audit **MUST** permettre :

- attribution (qui), action (quoi), temporel (quand), portée (scope), résultat (succès/échec), justification (reason codes)
- reconstitution d’un récit de production : “qu’est-ce qui s’est passé” et “pourquoi”

---

## 2. Modèle canonique de corrélation end-to-end

### 2.1 Identifiants canoniques

Les identifiants suivants **MUST** exister et être propagés dans les traces/logs/audits (au minimum en tant que champs structurés) :

- **commandId** : issu de `Command.commandId`.
- **txId** : issu de `TransactionReceipt.txId` et `EventEnvelope.txId`.
- **eventId** : issu de `EventEnvelope.eventId`.
- **projectionRunId** : identifiant d’une exécution de projection (delta, rebuild, recovery).
- **correlationId** : identifiant de corrélation end-to-end (voir 2.2).

Règle : ces IDs sont **opaques** (aucune dépendance de format) et **uniques** dans leur domaine.

### 2.2 Définition de `correlationId`

`correlationId` est l’identifiant de corrélation d’un **flux causal**.

- À réception d’une Command, le Runtime **MUST** associer un `correlationId` à l’exécution.
- Si `Command.clientContext.requestId` est présent, le Runtime **SHOULD** l’utiliser comme `correlationId` (sinon en générer un).
- Les retries idempotents (même `(actor, idempotencyKey)`) **MUST** conserver le même `correlationId` **pour la même requête** si le client le fournit ; sinon le système **MAY** créer un nouveau `correlationId` de transport mais **MUST** conserver la liaison vers le même résultat canonique (même receipt / erreur finale).

### 2.3 Graphe de corrélation (Trace Graph)

Le système **MUST** matérialiser (au moins dans les logs/audits) les liens suivants :

- `correlationId → commandId`
- `commandId → (receipt | error)`
- `commandId → txId` (si committed)
- `txId → eventId*` (meta et graph)
- `txId → cursorAfter` (admissible, tx-closed)
- `(txId, projectionSpecId, logicalSnapshotRef, eventCursorBefore/After) → projectionRunId`
- `projectionRunId → invalidationReasons*` (si rebuild/invalidations)
- `txId → syncDeltas*` (livraisons vers clients, filtrées)

Ces liens **MUST** être reconstruisibles sans dépendre d’informations non contractuelles.

### 2.4 Propagation minimale par couche

**Sync Gateway / Transport** :

- MUST loguer `correlationId`, `clientId?`, `uiSessionId?`, `graphSpaceId`, `requestStart/End`, statut transport.

**Runtime** :

- MUST loguer `correlationId`, `commandId`, `idempotencyKey?`, `actor`, `scope.plane` (au sens `CommandScope.plane`), décision (commit/reject), `txId?`, `cursorAfter?`.

**Kernel** :

- MUST loguer les décisions structurées : validation, authorize, lock, precondition.
- MUST produire/propager des `reasonCode` normatifs en cas de rejet.

**EventStore** :

- MUST permettre de relier `txId → eventRefs` (via receipt et EventEnvelope).

**Projection Engine** :

- MUST produire un `projectionRunId` pour chaque calcul (delta/rebuild/recovery), corrélé à `projectionSpecId`, `logicalSnapshotRef` et `eventCursor`.

**Sync** :

- MUST loguer des agrégats (non-fuyants) : taux de redelivery, erreurs, et progression par cursors, sans révéler des entités masquées.

---

## 3. Modèle d’audit log

### 3.1 Principe

Un **Audit Log** est un journal append-only d’enregistrements structurés (machine-readable) décrivant les actions et décisions du système.

L’audit est séparé de l’EventStore :

- l’EventStore est la **source canonique** des mutations (Events).
- l’AuditLog est la **source canonique** des explications et attributions (qui/quoi/pourquoi), sans modifier la vérité ontologique.

### 3.2 AuditRecord (schéma normatif)

```json
AuditRecord {
  auditId: string,
  timestamp: ISO8601,

  correlationId: string,
  graphSpaceId: string,

  actor: ActorRef,
  subjectType: "human" | "service" | "system",

  action: {
    kind: "command" | "sync" | "projection" | "admin" | "system",
    name: string,
    commandId?: string,
    idempotencyKey?: string
  },

  scope: {
    plane: "graph" | "meta" | "overlay",
    metaSeq?: int,
    graphSeq?: int,
    overlayId?: string,
    baseGraphRevision?: string
  },

  targets: {
    entityRefs?: EntityRef[],
    targetCount?: int
  },

  outcome: {
    status: "success" | "rejected" | "error",
    category?: "VALIDATION" | "PERMISSION" | "CONFLICT" | "PRECONDITION" | "NOT_FOUND" | "INTERNAL",
    reasonCode?: string,
    masked?: boolean,
    retryable?: boolean
  },

  canon: {
    txId?: string,
    cursorAfter?: { metaSeq: int, graphSeq: int },
    eventRefs?: {
      meta?:  [{ seq: int, eventId: string }],
      graph?: [{ seq: int, eventId: string }]
    }
  },

  diagnostics?: {
    lock?: { acquired: boolean, contentionKeyCount?: int },
    validationErrorCount?: int,
    authorize?: { decision: "allow" | "deny" | "mask", reasonCode?: string }
  }
}
```

### 3.3 Règles de complétude

- Tout `TransactionReceipt` **MUST** produire au moins 1 `AuditRecord` (action.kind=`command`) contenant `commandId`, `txId`, `cursorAfter`, et `eventRefs`.
- Toute `CommandError` **MUST** produire au moins 1 `AuditRecord` contenant `commandId?`, `idempotencyKey?`, `category`, `reasonCode`, `masked`, `retryable`.
- Si `masked=true`, l’AuditRecord **MUST** rester non-fuyant :
  - `targets.entityRefs` **MUST NOT** contenir de références révélatrices dans un canal accessible au sujet masqué.
  - l’accès à cet AuditRecord **MUST** être contrôlé (voir 3.5).

### 3.4 Codes et stabilité

- Les décisions **MUST** être exprimées via `reasonCode` stables (cf. CommandError + Permissions model).
- Les messages humains (`message`) **MAY** exister mais **MUST NOT** être utilisés comme clé de diagnostic.

### 3.5 Accès et séparation des vues d’audit

Le système **MUST** proposer deux “vues” (même si stock unique) :

1. **Audit technique (TAUD)**

- usage : SRE / engineering / sécurité.
- contient corrélations détaillées (y compris `txId`, `eventRefs`, `projectionRunId`).
- accès : fortement restreint (admin/opérateur), journalisation d’accès obligatoire.

2. **Audit fonctionnel (FAUD)**

- usage : produit / conformité / utilisateurs autorisés.
- dérivé des receipts/events (ou filtré) et **MUST** respecter `allow|deny|mask`.
- ne doit pas exposer de détails techniques inutiles (contention keys, traces internes, etc.).

Règle : TAUD peut contenir des détails révélateurs (y compris existence) mais son accès est strictement limité ; FAUD **MUST** être non-fuyant.

---

## 4. Métriques systémiques minimales

### 4.1 Exigence générale

Le système **MUST** exposer des métriques opérationnelles minimales. Cette spécification fixe :

- les **signaux sémantiques** obligatoires,
- les contraintes de **non-fuite** et de **cardinalité**,
- sans imposer un schéma de nommage (Prometheus/OpenTelemetry/etc.).

Les métriques **MUST** être distinguées en :

- **internes admin** (SRE/ops) : riches, à cardinalités élevées possibles,
- **exposables non-admin** : agrégées et non-fuyantes.

### 4.2 Signaux minimaux (v1)

**Commit / EventStore**

- Latence de commit (p50/p95/p99)
- Débit de commits
- Taille de transaction : nombre d’events `meta` et `graph` par `txId`
- Compteur de violations d’invariants (`tx-closed`, ordre `meta → graph`) (**MUST** rester à 0)

**Lag / Backlog**

- Event lag `meta` : différence entre dernier `metaSeq` disponible et dernier `metaSeq` appliqué/servi
- Event lag `graph`
- Projection lag : différence entre cursor cible et cursor servi pour chaque `projectionSpecId`
- Sync backlog : delta entre `cursorAfter` côté serveur et `cursor`/tokens côté client (agrégé)

**Rebuild / Cache / Snapshots**

- Compteur et durée des rebuilds de projection
- Compteur de chargements de snapshots de projection, et taux de miss
- Compteur d’invalidations, par code (voir §5.2)

**Locks / Concurrency**

- Taux de contention lock
- Temps d’attente lock (si observable)
- Taux de rejets pour conflit / staleness

**Commands**

- Débit de soumission
- Débit de commit
- Débit de rejet, par catégorie (VALIDATION / PERMISSION / CONFLICT / PRECONDITION / NOT\_FOUND / INTERNAL)
- Taux de hits idempotency (même `(actor, idempotencyKey)`)

**Sync / Delivery**

- Latence de poll / subscribe
- Taux de déconnexion subscribe
- Taux de redelivery (duplications) compatible cursors
- Taux d’events filtrés (agrégé, non-fuyant)

**Erreurs**

- Taux d’erreurs par surface (kernel/runtime/projection/sync/eventstore)
- Taux d’erreurs par `reasonCode` (agrégé)

### 4.3 Règles anti-fuite (métriques)

- Toute métrique exposée à un sujet non-admin **MUST** être agrégée de façon à ne pas permettre d’inférer l’existence d’entités masquées.
- Les labels/attributs à cardinalité liée à `EntityRef` **MUST NOT** être exportés hors canaux administratifs.

---

## 5. Diagnostic des projections

### 5.1 ProjectionRun (trace d’exécution)

Le Projection Engine v1 définit un **ProjectionCache** avec :

- `id`, `projectionSpecId`, `logicalSnapshotRef`,
- `validity.eventCursor`, `validity.logicalCursor`, `validity.invalidationReasons[]`.

Pour rendre le calcul inspectable, chaque calcul de projection (delta/rebuild/recovery) **MUST** émettre un enregistrement de run corrélé, identifié par `` (opaque) :

```txt
ProjectionRun {
  projectionRunId,
  projectionSpecId,
  graphSpaceId,

  logicalSnapshotRef,
  eventCursorBefore,
  eventCursorAfter,

  mode: delta | rebuild | recovery,

  cacheRef?: { projectionCacheId: string },

  timings { total_ms, loadSnapshot_ms?, applyEvents_ms, compute_ms },

  invalidationReasons?: InvalidationReason[]
}
```

Règles :

- `projectionRunId` **MUST** être unique pour chaque calcul.
- Si un calcul met à jour un cache existant, `cacheRef.projectionCacheId` **SHOULD** référencer `ProjectionCache.id`.
- Les `invalidationReasons` d’un run **MUST** être cohérents avec `ProjectionCache.validity.invalidationReasons` lorsque le cache est touché.

### 5.2 InvalidationReason (normatif)

```txt
InvalidationReason {
  code: "EVENT_GAP" | "LOGICAL_SNAPSHOT_CHANGED" | "SNAPSHOT_CORRUPT" | "SCHEMA_VERSION_MISMATCH" | "MANUAL_REBUILD" | "INTERNAL_ERROR",
  details?: object
}
```

### 5.3 Équivalence incremental vs rebuild

Le moteur **SHOULD** supporter un check d’équivalence (admin) :

- état après deltas incrémentaux
- vs état après rebuild complet

En cas d’écart :

- MUST émettre un diagnostic corrélé à `projectionRunId`
- MUST classifier via `InvalidationReason.code = INTERNAL_ERROR` (ou un code plus précis si défini ultérieurement)

---

## 6. Gestion des erreurs et surfaces d’alerte

### 6.1 Taxonomie des erreurs (surfaces)

Le système **MUST** classifier les erreurs par surface :

- `kernel` (validation/permission/lock/precondition)
- `eventstore` (commit/read/tx-closed)
- `runtime` (orchestration, application meta→graph)
- `projection` (compute/rebuild/snapshot)
- `sync` (delivery/filtering/cursors)

Chaque erreur **MUST** inclure : `correlationId` et, si applicable, `commandId`, `txId`, `projectionRunId`.

### 6.2 Alerte minimale (v1)

Le système **MUST** définir au moins les alertes suivantes :

**Sécurité / conformité**

- `ALERT.TX_CLOSED_VIOLATION` (sev: critical)
- `ALERT.META_GRAPH_ORDER_VIOLATION` (sev: critical)
- `ALERT.MASK_LEAK_SUSPECTED` (sev: critical) : indicateurs de fuite (ex. erreurs différenciées, surfaces non conformes)

**Correctness / déterminisme**

- `ALERT.REPLAY_DIVERGENCE` (sev: critical)
- `ALERT.PROJECTION_NON_DETERMINISM` (sev: high)

**Disponibilité / perf**

- `ALERT.PROJECTION_LAG_HIGH` (sev: medium/high selon seuil)
- `ALERT.SYNC_BACKLOG_GROWING` (sev: medium)
- `ALERT.LOCK_CONTENTION_HIGH` (sev: medium)

### 6.3 Surfaces d’extraction (debug/inspect)

Le système **MUST** offrir des endpoints/outils d’inspection (accès admin) permettant :

- retrouver receipt / erreur finale par `(actor, idempotencyKey)` et par `commandId`
- retrouver `EventEnvelope[]` par `(stream, seq-range)` et par `txId`
- retrouver `ProjectionRun` et les raisons d’invalidation par `projectionRunId`
- produire un “explain” minimal (voir 6.4)

### 6.4 Explain (récit machine-readable)

Pour un `commandId` ou `txId`, le système **MUST** pouvoir produire (accès admin) un artefact d’explication structuré **composable à partir d’artefacts canoniques** : receipts, eventRefs, cursors, et diagnostics de projection.

```txt
ExplainReceipt {
  correlationId,
  commandId,
  actor,
  scope,

  decision: committed | rejected,
  reasonCode?,

  txId?,
  cursorAfter?,
  eventRefs?,

  downstream: {
    projectionRuns?: projectionRunId[],
    syncProgress?: { channel: poll|subscribe, serverCursorAfter?: {metaSeq, graphSeq}, clientCursorKnown?: {metaSeq, graphSeq}? }[]
  }
}
```

Règle : une version “user-safe” **MUST** exister et respecter `mask`.

---

## 7. Invariants d’observabilité

### OA-INV1 — Aucune mutation sans trace

Toute mutation canonique (commit EventStore) **MUST** être reliée à au moins :

- un `commandId` (ou un `action.kind=system` explicitement autorisé, ex. migrations opérées via Command runner)
- un `txId`
- un `correlationId`

### OA-INV2 — Aucun event sans provenance

Tout `EventEnvelope` **MUST** être explicable par :

- `txId`
- `author`
- une source de déclenchement (commandId ou “system action” auditée)

### OA-INV3 — tx-closed observable

Toute API de lecture/propagation cursor-based **MUST** permettre de démontrer qu’elle respecte `tx-closed` (soit par construction, soit par refus explicite).

### OA-INV4 — Ordre sémantique observable

Le runtime et les consommateurs (projections/clients) **MUST** pouvoir prouver l’application `meta → graph` intra-transaction (logs/tracepoints).

### OA-INV5 — Rejeu et projection explicables

Toute divergence détectée entre replay, snapshot+replay, ou rebuild vs incremental **MUST** produire :

- un diagnostic corrélé (projectionRunId / correlationId)
- une classification (reason code / invalidation reason)

### OA-INV6 — Observabilité non-fuyante

Aucune surface d’observabilité exposée à un sujet non-admin **MUST** permettre de distinguer :

- “cible absente” vs “cible existante mais masquée” au-delà des classes explicitement indifférenciées prévues par le modèle `mask`.

---

## 8. Frontières : audit technique vs audit fonctionnel

### 8.1 Définition

- **Audit technique** : focalisé sur le fonctionnement du système (corrélations, performance, diagnostics, run IDs). Conçu pour l’exploitation et la sécurité.
- **Audit fonctionnel** : focalisé sur les actions et résultats pertinents au produit (qui a changé quoi dans quel workspace), en termes compréhensibles et non-fuyants.

### 8.2 Règles de frontière

- FAUD **MUST** être dérivable des artefacts canoniques (receipts/events) + règles de présentation/filtrage, sans nécessiter de lire des structures internes.
- TAUD **MAY** inclure des détails supplémentaires (contention, traces, diffs) mais **MUST** journaliser les accès à ces détails.
- Toute exposition d’audit à des non-admin **MUST** être conforme à `allow|deny|mask` (y compris sur la simple existence d’un enregistrement).

### 8.3 Cohérence avec l’inspection ontologique (OIR)

Les artefacts d’inspection affichables (ex. OIR/Placeholder) **MUST** pouvoir référencer (au minimum) :

- statut ontologique (Real/Derived/Overlay/Placeholder)
- provenance dérivée (si Derived) sous une forme non-fuyante
- permissions appliquées

Sans quoi, l’inspection ne peut pas être considérée comme “auditable”.

---

## 9. Annexes (non normatives)

- Exemples de dashboards (lag, contention, rebuilds) par graphSpaceId.
- Exemples de pipelines de corrélation (OpenTelemetry) : `correlationId` ↔ trace/span.

------------------------------------------------------------------------

## Source: system_cohesion_audit_v\_1.md

# System Cohesion Audit v1

Version: 1.0 Status: Audit analytique (cohérence systémique)

## 0. Périmètre

Livrables audités : Event Model, Command / Intent API, EventStore &
Persistence, Collaboration, Identity & Addressing, Workspace /
Packaging, Import / Export, Sync / Transport, Type Engine, Mutation
Engine, Graph Runtime, Projection Engine, Overlay System, View System,
Projection DSL, Permissions, MetaConstraints, MetaDraft diff/merge +
refactor ops, Ontological Inspection Protocol.

Objectif : vérifier la cohérence globale (invariants, interfaces, flux
bout‑en‑bout) et isoler contradictions/tensions et risques.

------------------------------------------------------------------------

## 1. Invariants globaux transverses

### I-01 --- Séparation ontologique (vue ≠ vérité)

-   Le Graph (instances réelles) validé par le MetaGraph est la vérité
    ontologique ; les projections et vues n'ont aucune autorité
    ontologique.
-   Overlay et Derived sont non canoniques tant qu'ils ne sont pas
    commités.

### I-02 --- EventStore append-only + immutabilité post‑commit

-   Tous les changements canoniques sont persistés en événements
    append‑only, jamais modifiés après commit.

### I-03 --- Deux streams distincts meta / graph

-   `meta` (loi) et `graph` (faits) ont des séquences indépendantes ;
    pas d'ordre total inter‑stream.

### I-04 --- Transactions atomiques + invariant tx-closed

-   Une transaction est visible comme un tout ; aucun consumer ne peut
    observer une transaction partielle.

### I-05 --- Ordre sémantique intra‑transaction : meta → graph

-   Les metaEvents précèdent logiquement les graphEvents d'une même
    transaction.

### I-06 --- Déterminisme par replay (à curseur admissible)

-   À `K=(metaSeq, graphSeq)` admissible : MetaState, GraphState (sous
    LogicalSnapshot), projections et ensembles de violations sont
    déterministes et reconstructibles.

### I-07 --- Mutations explicites uniquement (non‑magie)

-   Aucun write implicite ; toute modification passe par Command →
    Kernel/Mutation Engine → Transaction → EventStore.

### I-08 --- Validation structurée par types (autorité locale)

-   La validité structurelle est décidée par les contrats de type
    (schéma/contraintes locales), avec mécanismes de contraintes (L1/L2
    sync, L3 async) pour la loi.

### I-09 --- Pessimistic locking v1 (pas de merge concurrent sur Graph)

-   Toute écriture Graph requiert des locks exclusifs ; pas de merge
    concurrent en v1.

### I-10 --- Idempotence des Commands (exactly‑once sémantique)

-   `idempotencyKey` obligatoire ; rejouabilité sûre et receipts
    stables.

### I-11 --- Sécurité non‑fuyante (allow \| deny \| mask)

-   `mask` ne doit pas fuiter l'existence ; erreurs, locks et sync
    doivent rester non révélateurs.

### I-12 --- Deny‑wins (sur conflits de permissions au merge méta)

-   En cas de conflit de policies lors d'un merge de MetaDrafts, le
    moindre privilège gagne.

### I-13 --- Snapshots = accélérateurs non canoniques

-   Snapshots runtime/meta/graph/projection : invalidables et
    reconstructibles ; jamais source de vérité.

### I-14 --- Adressage unifié par plane + scope

-   Toute référence polymorphe passe par
    `EntityRef { graphSpace, kind, id, ... }` ; absence de collision
    inter‑plans.

### I-15 --- BaseGraphRevision (overlay) résolue canoniquement

-   `baseGraphRevision` n'est pas un `graphSeq` ; une fonction
    `resolveRevision(graphSpace, baseGraphRevision) -> graphSeq` est
    canonique.

------------------------------------------------------------------------

## 2. Vérification couche par couche vs invariants

### 2.1 Foundations (ontologie)

-   Conforme à I‑01/I‑07 : identité technique, sens porté par
    relations + types ; pas de magie.
-   Point à surveiller : formulation « EventStore non source de vérité »
    doit être interprétée comme « non autorité ontologique » (cohérent
    avec I‑01/I‑13), tout en restant la mémoire canonique (I‑02).

### 2.2 Type Engine + MetaGraph / Type System UI

-   Cohérent avec I‑08 : types = lois locales, contraintes, règles,
    priorités.
-   Cohérent avec versionning immuable du MetaGraph (I‑02 appliqué au
    plan meta via versions publiées).
-   Conformes aux invariants de refactor résoluble (mapping obligatoire)
    et à la stabilité des IDs meta.

### 2.3 MetaConstraints Language

-   Cohérent avec I‑08 : niveaux (L1/L2 sync, L3 async) + blocage de
    publish si L3 non ok.
-   Cohérent avec I‑01/I‑06 : violations dérivées, inspectables, non
    persistées.

### 2.4 Permissions model

-   Conforme à I‑11 : `allow | deny | mask` + reason codes.
-   Attendu : propagation de `mask` dans toutes les couches (Command
    errors, locks, sync filtering).

### 2.5 Command / Intent API

-   Conforme à I‑07/I‑10 : séparation Intent vs Command ; Command
    canonique idempotente ; receipt canonique.
-   Conforme à I‑05 : commit metaEvents puis graphEvents.
-   Zone sensible correctement identifiée et ensuite résolue par la
    Persistence layer : `baseGraphRevision` vs `graphSeq` (I‑15).

### 2.6 Mutation Engine (Kernel)

-   Conforme à I‑07/I‑09 : transaction atomique, lock pessimiste, commit
    EventStore.
-   Conforme à I‑08 : validation par type.
-   Cohérence globale : le Kernel est le point unique d'écriture ; le
    Runtime ne valide pas.

### 2.7 Event Model

-   Conforme à I‑02/I‑03/I‑04/I‑05/I‑06 : streams, cursors, tx‑closed,
    déterminisme.
-   Conforme à I‑01 : violations et projections = dérivés.
-   Contrainte notable : contraintes publiées « forward‑only » (ne
    rendent pas le passé invalide), compatible avec la notion de
    violations rétroactives affichées.

### 2.8 EventStore & Persistence

-   Conforme à I‑02/I‑04 : append, tx‑closed, indexation normative,
    lecture par `seq`.
-   Conforme à I‑13 : snapshots non canoniques.
-   Résout proprement I‑15 via `resolveRevision`.

### 2.9 Graph Runtime

-   Conforme à I‑07 : orchestre, ne valide pas, n'écrit pas.
-   Conforme à I‑05 : applique metaDelta puis graphDelta.
-   Conforme à I‑13 : caches/snapshots invalidables.

### 2.10 Projection Engine + Projection DSL + View System

-   Conforme à I‑01/I‑06 : projection = f(EventStream, LogicalSnapshot),
    déterministe à snapshot fixe.
-   Conforme au pipeline DSL (scope unique, no write, provenance
    obligatoire, expand borné).
-   Cohérence avec Runtime : deltas incrémentaux + rebuild.

### 2.11 Overlay System + Collaboration Model

-   Overlay conforme à I‑01 : non ontologique tant que non commit.
-   Cohérent avec I‑09 : overlay‑level lock pour édition ; graph locks
    au moment du commit.
-   Cohérent avec I‑15 : commit overlay requiert `resolveRevision` puis
    précondition stricte.

### 2.12 Workspace / Packaging + Import/Export

-   Conforme à I‑14 : `graphSpaceId` = racine canonique.
-   Conforme à I‑02/I‑07 : import n'écrit jamais directement EventStore
    (Commands uniquement).
-   Import v1 « workspace vide » cohérent avec absence de merge (I‑09).

### 2.13 Sync / Transport

-   Conforme à I‑10 : retries safe via idempotence.
-   Conforme à I‑03/I‑04 : in‑order par stream, tx‑closed, duplication
    tolérée.
-   Conforme à I‑11 : filtrage non‑fuyant requis (détails hors scope,
    mais invariant normatif présent).

------------------------------------------------------------------------

## 3. Flux bout‑en‑bout (Command → Event → Runtime → Projection → Sync)

### 3.1 Flux nominal (Graph)

1)  Client émet une Command canonique (scope graphSpace +
    idempotencyKey).
2)  Sync transmet sans altérer.
3)  Runtime soumet au Kernel.
4)  Kernel : validation (type/contraintes), authorize (allow/deny/mask),
    acquisition locks (exclusive), commit transaction (EventStore).
5)  EventStore rend la transaction visible (tx‑closed) sur `meta` et/ou
    `graph`.
6)  Runtime observe le commit, applique deltas en mémoire (meta puis
    graph), avance cursors.
7)  Runtime notifie les projections ouvertes (applyEventDelta).
8)  Sync propage les EventEnvelopes (at‑least‑once, in‑order par stream,
    tx‑closed) + cursors monotones.

Points de cohérence : - Idempotence : une perte réseau sur submit est
neutralisée. - Aucune étape post‑commit ne peut « échouer » en modifiant
le canon : toute incohérence devient un signal (violation report), pas
un rollback.

### 3.2 Flux nominal (Overlay → commit)

1)  Édition overlay : Commands `plane=overlay` qui modifient un
    DeltaSet/AnnotationSet, protégées par lock overlay‑level.
2)  Commit overlay :
    -   lock overlay pour geler le DeltaSet,
    -   `resolveRevision(baseGraphRevision) -> graphSeqBase`,
    -   précondition stricte `currentGraphSeq == graphSeqBase`,
    -   calcul des `targetEntities` réelles,
    -   lock graph sur targets,
    -   validation/authorize,
    -   commit events graph,
    -   receipt inclut `entityIdMap` (tempId → realId).
3)  Runtime applique et notifie ; Sync propage événements + receipt.

Points de cohérence : - Pas de rebase automatique v1 : cohérent avec
absence de merge. - Mapping IDs garantit la réconciliation UI.

### 3.3 Flux Meta (édition loi)

1)  UI Type System édite via MetaDraft (deltaSet).
2)  MetaValidation interne + GraphCompatibilityCheck + MigrationPlan
    explicite (si requis).
3)  Publish : produit meta.version.published + meta.\* events.
4)  Runtime applique metaDelta, met à jour LogicalSnapshot.
5)  Projections dépendantes : invalidation/rebuild selon logicalCursor.

------------------------------------------------------------------------

## 4. Identités et frontières (IDs, scopes, migrations, replay)

### 4.1 Racine de scope

-   `graphSpaceId` est la frontière canonique : EventStore, IDs,
    cursors, sessions/locks.
-   WorkspaceId administratif : ne doit pas être utilisé comme racine
    d'adressage.

### 4.2 Planes et non‑collision

-   Planes distincts : graph / meta / overlay / derived / event.
-   Toute interface polymorphe utilise
    `EntityRef(kind + graphSpace + id)`.

### 4.3 Stabilité des IDs

-   GraphNodeID/GraphEdgeID stables à vie (non recyclés).
-   IDs meta
    (TypeID/FieldID/RelationTypeID/PolicyID/ConstraintID/InvariantID/ModuleID)
    stables à travers versions ; rename ≠ nouvel ID.
-   OverlayLocalID scoped à (graphSpace, overlayId), jamais confondu
    avec GraphID.
-   DerivedID scoped à (graphSpace, projectionInstanceId) + provenance
    obligatoire.

### 4.4 Replay et migrations

-   Replay canonique : EventStore → MetaState(metaSeq) → LogicalSnapshot
    → GraphState(graphSeq) sous snapshot.
-   Migrations Meta : explicites, versionnées, exécutées via Commands
    (pas d'écriture directe EventStore).
-   Refactors Meta : doivent fournir mapping résoluble ; sinon commit
    interdit.

### 4.5 Frontières de sécurité (mask)

-   Les surfaces qui exposent des références (inspection, errors, sync,
    locks) doivent pouvoir filtrer/masquer sans fuite.

------------------------------------------------------------------------

## 5. Tensions / contradictions potentiielles (résolues par verrou normatif v1)

Les tensions identifiées dans la version initiale proviennent
d'ambiguïtés terminologiques ou d'absence de mécanisme explicitement
normé. Elles sont levées par les verrous V‑1, V‑2 et V‑3 ci‑dessous.

### V‑1 --- Vérité vs mémoire canonique

Définitions normatives :

-   **State (graph tables)** = autorité ontologique courante.
-   **EventStore** = mémoire canonique de l'historique (append-only,
    tx-closed), utilisée pour audit, replay, rollback.
-   **Snapshots / Projections / Overlays / Caches** = artefacts dérivés,
    non autoritatifs, recalculables.

Clause impérative :

> Toute modification canonique MUST passer par une mutation
> transactionnelle et être enregistrée dans l'EventStore. Aucune
> écriture directe dans un snapshot, une projection ou un overlay ne
> constitue un commit canonique.

Cette clarification élimine toute ambiguïté d'implémentation.

### V‑2 --- Validation commit-time vs contraintes globales (L3)

Découpage normatif :

-   **Commit Graph (bloquant)** : validation exclusivement par le
    contrat du type (schéma + contraintes locales du type).
-   **Contraintes globales L3 (non bloquant)** : évaluées post-commit
    pour signalement, diagnostic, migration, garde-fous UI/export.

Clause impérative :

> Les contraintes globales L3 ne bloquent pas un commit Graph v1. Elles
> peuvent bloquer une publication meta, mais pas invalider
> rétroactivement l'historique.

La séparation des étages supprime la contradiction apparente entre «
type seule autorité au commit » et inspection globale.

### V‑3 --- Sync non-fuite sous mask (Stratégie retenue v1 : S1)

Stratégie normative adoptée : **curseurs par scope de visibilité (S1)**.

-   Le serveur filtre les événements selon les permissions avant
    exposition.
-   Chaque principal dispose d'un curseur monotone dans son flux filtré.
-   Aucun trou de séquence n'est observable côté client.

Clause impérative :

> Le serveur MUST exposer des curseurs par principal sur le flux filtré.
> Les clients MUST NOT recevoir le graphSeq global si cela introduit des
> discontinuités dues au masking.

Cette stratégie garantit simultanément : tx-closed, monotonie des
curseurs et absence d'inférence par trous.

## 6. Classification des risques

Classification des risques

### Critical

1)  R-C1 --- Fuite d'existence via `mask`

-   Couvert par V‑3 (curseurs par visibilité). Reste critique si non
    implémenté strictement.

2)  R-C2 --- Violation de tx-closed côté EventStore ou Sync

-   Toujours critique : détruit le déterminisme.

3)  R-C3 --- Non-respect meta→graph intra-transaction

-   Toujours critique : incohérence non reproductible.

### Structural

1)  R-S1 --- Confusion « vérité » / « mémoire »

-   Levée par V‑1. Devient risque documentaire uniquement.

2)  R-S2 --- Implémentation incorrecte des curseurs filtrés

-   Risque d'architecture si le modèle S1 n'est pas strictement
    respecté.

3)  R-S3 --- Pipeline L3 (exécution async + historique de runs)

-   Complexité opérationnelle, non contradiction systémique.

4)  R-S4 --- Compatibilité import/export (IDs conservés)

-   Limitation produit assumée en v1.

### Acceptable

1)  R‑A1 --- Overlay sans rebase automatique v1

-   Limite assumée, cohérente avec le non‑merge.

2)  R‑A2 --- Pas d'ordre total inter‑stream

-   Compensé par curseur global et règles d'application ; acceptable en
    v1.

------------------------------------------------------------------------

## 7. Recommandations correctives

### 7.1 Clarifier le triangle « vérité / mémoire / vue » (doc-level)

-   Ajouter une note normative unique (référencée par tous les
    livrables) :
    -   EventStore = mémoire canonique (append-only),
    -   GraphState(K) sous LogicalSnapshot(K) = réalité reconstruite,
    -   Projections/Views/Overlays/Snapshots = caches/preview non
        autoritatifs.

### 7.2 Spécifier un minimal viable pour le filtrage Sync sous `mask`

-   Définir un comportement canonique de transport lorsqu'un event
    touche une entité masquée :
    -   soit suppression silencieuse + maintien de la progression par
        cursor via `cursorAfter` (sans exposer de « trous »),
    -   soit agrégation non révélatrice (ex : « graph changed » sans
        cibles).
-   Formaliser des tests d'invariants : pas de fuite par contenu,
    erreurs, ni métadonnées.

### 7.3 Consolider la règle L3 (où et quand elle bloque)

-   Rappeler explicitement :
    -   L3 bloque publish meta (loi),
    -   L3 ne bloque pas rétroactivement l'histoire graph,
    -   les violations sont observées via projection/inspection.

### 7.4 Vérifier l'unicité des surfaces de référence d'identité

-   Exiger `EntityRef` partout où un ID nu pourrait être ambigu
    (inspection, audit, logs, tooling).

### 7.5 Tests de cohérence bout‑en‑bout (contract tests)

-   Définir un jeu de tests contractuels :
    -   submit retry → receipt identique,
    -   commit overlay → entityIdMap exhaustif,
    -   tx‑closed observé via readStream/poll,
    -   application meta→graph au Runtime et côté client,
    -   rebuild projection = équivalent à incremental (à inputs égaux),
    -   resolveRevision déterministe et refuse les révisions non
        résolubles.

------------------------------------------------------------------------

## 8. Conclusion de l'audit

Après intégration des verrous normatifs V‑1, V‑2 et V‑3 :

-   La séparation ontologique est formellement verrouillée.
-   Le rôle respectif de State et EventStore est clarifié sans modifier
    l'architecture.
-   La validation commit-time est strictement limitée au contrat de
    type.
-   Les contraintes globales L3 sont positionnées post-commit, non
    bloquantes.
-   La Sync garantit non-fuite via curseurs par visibilité.

Le système est cohérent au niveau architectural et normatif pour une v1.

Les risques restants sont principalement d'implémentation (tx-closed
strict, respect meta→graph, filtrage correct sous mask) et non des
contradictions de conception.

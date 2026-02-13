# Mesh Application Layer Compiled

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: application_layer_foundations_v_1.md

# Application Layer Foundations v1

Version: 1.0  
Status: Normatif  
Scope: Couche applicative — primitives UI, comportements canoniques, invariants UX

---

# 0. Positionnement

La couche applicative Mesh Explorer est la traduction interactionnelle des couches systémiques déjà spécifiées.

Elle :
- N’introduit aucune autorité ontologique.
- N’altère aucun invariant système.
- Ne redéfinit ni le Runtime, ni le Kernel, ni la Sync Layer, ni le Projection Engine.
- Rend opérable le moteur sans trahir ses lois.

La couche applicative est un orchestrateur UX, pas un moteur de vérité.

---

# 1. Définition normative d’une “Application Mesh Explorer”

## 1.1 Définition

Une Application Mesh Explorer est un système interactif qui :

1. Ouvre des projections déterministes à partir d’un GraphSpace.
2. Permet l’émission d’Intent/Command conformes.
3. Ordonne overlays, locks et commits selon le modèle de collaboration.
4. Expose l’inspection ontologique (OIR).
5. Respecte strictement allow | deny | mask.

Elle n’a :
- aucune autorité sur l’EventStore,
- aucune capacité de write hors Command → Kernel.

## 1.2 Propriété fondamentale

Application = orchestrateur UX au-dessus de :

Graph + MetaGraph + Projection + Overlay + Sync + Permissions.

Règle centrale : **aucune mutation n’est tenue pour effective tant qu’un `TransactionReceipt` (ou `CommandError`) n’a pas été reçu**.

Conséquences :
- Une action UI peut produire une représentation immédiate (overlay/projection), mais **ne modifie jamais le canon**.
- Toute confirmation de changement canonique est basée sur le receipt (jamais sur un ack transport, ni sur un état local supposé).

---

# 2. Primitives UI minimales

Les primitives suivantes sont obligatoires en v1.

## 2.1 Graph View

Surface principale de visualisation.

Caractéristiques :
- Affiche un ViewModel (Real / Derived / Overlay / Placeholder).
- N’affiche jamais l’état brut du Graph.
- Toujours associée à un ProjectionInstance explicite.
- Peut avoir un contextOverride (simulation).

Invariants :
- Projection ≠ vérité.
- Derived toujours avec provenance inspectable.
- Placeholder jamais révélateur.

---

## 2.2 Inspector

Surface d’inspection structurée d’un élément sélectionné.

Affiche :
- OntologicalStatus (Real / Derived / Overlay / Placeholder)
- TypeInfo
- ScopeInfo
- Permissions effectives
- Provenance (si Derived)

Invariants :
- Statut ontologique toujours visible.
- Permissions évaluées côté moteur.
- Aucun ID masqué exposé.

---

## 2.3 Panels

Panneaux secondaires (liste, hiérarchie, métriques, violations).

Caractéristiques :
- Basés sur Projection.
- Toujours synchronisés par cursor admissible.
- Ne possèdent aucune logique métier.

Verrou v1 : cohérence d’instant
- Un Panel qui dépend des mêmes données qu’un Graph View **DOIT** être attaché à la **même ProjectionInstance**.
- Si un Panel est alimenté par une projection différente (ou en rattrapage), il **DOIT** l’indiquer explicitement (état “syncing / catching up”) et ne pas prétendre refléter le même instant.

---

## 2.4 Navigation

Navigation = changement de ProjectionInstance + UIState.

Peut inclure :
- changement de ViewPreset
- changement de contexte (preview/simulation)
- ouverture d’Overlay

Invariants :
- Aucun changement de contexte ne modifie le Graph.
- Les cursors sont monotones.

---

## 2.5 Overlay Indicator

Indicateur visible qu’une vue inclut un Overlay.

Affiche (si et seulement si l’overlay est visible pour le sujet) :
- overlayId
- statut (draft / hypothesis / annotation)
- baseGraphRevision

Invariant :
Overlay ≠ Truth.

Note de sécurité : si l’overlay est `mask`, l’indicateur doit être indistinguable d’un cas « overlay inexistant ».

---

## 2.6 Lock Indicator

Affiche l’état de verrouillage pertinent pour l’utilisateur.

Contraintes :
- **User-safe** : ne révèle jamais (1) l’identité d’un owner, (2) l’existence d’une cible masquée, (3) la différence entre « absent » et « masqué ».
- **Admin-safe** (surface restreinte) : peut exposer des diagnostics (ex. `masked=true`, détails lock), sans être accessible aux sujets non privilégiés.

---

# 3. Invariants UX dérivés des invariants système

## UX-INV-1 — Projection ≠ Vérité

Toute action visible est une lecture dérivée.

Conséquence UX :
- Les modifications ne prennent effet qu’après receipt.

---

## UX-INV-2 — Overlay non destructif

Un overlay ne modifie jamais le Graph tant qu’il n’est pas commit.

Conséquence UX :
- Toujours distinguer visuellement Draft vs Graph.

---

## UX-INV-3 — Mask non révélateur

Une entité masquée est traitée comme inexistante.

Conséquence UX :
- Pas de message différencié.
- Pas d’indicateur de lock révélateur.

---

## UX-INV-4 — tx-closed perceptible

Aucune transaction partielle ne doit être visible.

Conséquence UX :
- Rafraîchissement post-commit atomique.
- L’UI se synchronise uniquement sur des cursors admissibles exposés à son principal (cursors filtrés), et tolère la redelivery (at-least-once) via déduplication.

---

## UX-INV-5 — Idempotence transparente

Retry utilisateur ne doit pas produire d’effet double.

---

# 4. Comportement canonique d’un Graph Editor

## 4.1 Création (via Overlay recommandé)

1. Ouvrir Overlay (lock overlay-level).
2. Ajouter DeltaSet.
3. Affichage immédiat via OverlayGraphView.

Aucune mutation ontologique.

---

## 4.2 Édition

Mutation via Overlay (recommandé) ou Command directe (cas simple).

Toujours :
- Respect permissions.
- Respect locks.

Verrou v1 : choix Overlay vs Command directe
- Par défaut, toute édition multi-étapes ou multi-entités **SHOULD** passer par Overlay (Draft) afin de préserver la lisibilité du workflow (pré-visualisation, commit explicite).
- La Command directe **MAY** être utilisée pour des opérations atomiques triviales et immédiatement réversibles (ex. patch local sur un champ), à condition de ne jamais présenter l’effet comme canonique avant receipt.

---

## 4.3 Commit Overlay

Pipeline UX canonique :

1. Vérifier statut overlay = draft.
2. Submit commit Command.
3. Attendre TransactionReceipt.
4. Appliquer entityIdMap.
5. Fermer overlay ou le maintenir.

En cas d’échec :
- PRECONDITION → divergence baseGraphRevision.
- CONFLICT → lock.
- PERMISSION → deny/mask.

Aucune tentative de merge automatique.

---

## 4.4 Conflits

Types UX :
- Locked
- Cursor mismatch
- Permission

Comportement :
- Affichage explicite des reason codes.
- Aucune fusion implicite.

Remédiations autorisées (v1) :
- attendre / réessayer (idempotence),
- abandonner,
- créer un nouvel overlay sur une base stable et recommencer.

---

# 5. Navigation et State

## 5.1 ViewPreset

Artefact persisté décrivant :
- projectionSpecId
- paramètres
- layout hints

Ne contient pas :
- état ontologique

Verrou v1 : contenu non révélateur
- Un ViewPreset **MUST NOT** embarquer des listes d’EntityRef/IDs canoniques (ex. “ouvrir ces 200 nœuds par id”), ni de données qui deviendraient révélatrices sous `mask`.
- Tout ciblage d’entités doit passer par la projection (qui produira Real/Placeholder selon permissions).

---

## 5.2 UIState (éphémère)

Contient :
- sélection
- filtres locaux
- zoom
- panneau ouvert

Ne persiste jamais dans le Graph.

---

## 5.3 Scopes

Toute interaction est scoped par :
- graphSpaceId
- plane (graph / overlay)
- projectionInstance

---

## 5.4 Barrières de cohérence (meta/graph)

Le système n’impose pas d’ordre total inter-stream.

Verrou v1 : une vue ne se déclare “cohérente” que lorsque la barrière choisie est satisfaite.
- Par défaut, l’application **SHOULD** attendre une barrière minimale garantissant une lecture admissible (tx-closed) et l’ordre sémantique intra-transaction (meta puis graph) avant d’annoncer “à jour”.
- Si la barrière n’est pas satisfaite : la vue doit afficher un état de synchronisation (ex. “updating”), sans présenter un état partiel comme final.

---

# 6. Intégration des locks pessimistes côté UX

## 6.1 Principe

L’UX ne décide pas des locks.

Elle :
- soumet des Commands,
- interprète les receipts/erreurs,
- maintient (si présent) un contexte de session UI (`uiSessionId`) pour permettre au système d’associer leases/heartbeats quand requis.

## 6.2 Indication visuelle

Si une Command est rejetée pour lock :
- user-safe : afficher un état non révélateur (ex. “resource busy”), sans identité d’owner et sans fuite sous `mask`.
- admin-safe : diagnostics possibles (surface restreinte).

## 6.3 Overlay-level exclusif

Un seul éditeur actif par overlay.

UX doit :
- empêcher l’édition concurrente d’un même overlay,
- traiter `CMD.CONFLICT.LOCKED` comme état normal de contention (pas d’auto-merge).

---

# 7. Gestion des erreurs et feedback

## 7.1 User-safe

Expose (minimum) :
- status
- category
- reasonCode
- retryable (si disponible)

Ne révèle pas :
- existence masquée
- identité d’owner de lock
- détails internes (contention keys, diagnostics kernel)

## 7.2 Admin-safe

Peut inclure (surface restreinte) :
- masked=true
- diagnostics lock
- détails authorize

Accès restreint.

## 7.3 Verrou v1 : matrice “surface → niveau de détail”

L’application **DOIT** appliquer une règle uniforme de présentation :
- Notifications UI utilisateur : user-safe uniquement.
- Surfaces d’inspection/audit opérateur : admin-safe, avec contrôle d’accès.

---

# 8. Contraintes de cohérence interactionnelle

## 8.1 Pas d’inférence via UI

L’UI ne doit pas permettre de déduire :
- entité masquée
- transaction partielle
- divergence interne

---

## 8.2 Pas de mutation implicite

Toute modification doit correspondre à une Command observable.

---

## 8.3 Pas de cache cross-principal

Toute vue filtrée doit être scoped par principal.

---

# 9. Limites assumées v1

1. Pas de merge concurrent.
2. Pas de rebase overlay automatique.
3. Pas d’ordre total inter-stream.
4. Pas de co-édition fine d’un overlay.
5. Pas de gestion offline optimiste.

---

# 10. Résumé

L’Application Layer v1 transforme un moteur événementiel strict en expérience utilisable.

Elle respecte :
- séparation ontologique
- tx-closed
- pessimistic locking
- deny-wins
- déterminisme par replay
- non-fuite sous mask

Elle ne simplifie pas le système.
Elle l’expose correctement.

Sans magie.
Sans raccourci.
Sans trahison des invariants.


------------------------------------------------------------------------

## Source: interaction_contracts_editor_semantics_v_1.md

# Interaction Contracts & Editor Semantics v1

Version: 1.0  
Status: Normatif  
Scope: Contrats d’interaction UI ↔ Runtime/Command/Overlay + Sémantique canonique du Graph Editor

Strictement compatible avec :
- Command / Intent API v1
- Overlay System v1.5
- Collaboration Model v1 (pessimistic locking)
- Security Hardening v1 (mask non révélateur, tx-closed strict)
- Sync Layer v1
- Application Layer Foundations v1

---

# 1. Définition normative d’un Interaction Contract

## 1.0 Clauses de verrouillage systémique (v1)

Les Interaction Contracts DOIVENT respecter strictement les verrous suivants, déjà définis dans les couches système :

1. Receipt-only truth : aucun effet n’est canonique avant TransactionReceipt.
2. Atomicité stricte : toute Command multi-cibles est commitée intégralement ou rejetée intégralement.
3. Pas de rebase automatique : toute divergence de base entraîne un rejet PRECONDITION.
4. Mask indistinguable : aucune surface user-safe ne distingue "absent" de "masqué".
5. Cursor tx-closed : aucun état partiel observable.
6. Undo append-only : aucun événement n’est supprimé ou modifié.

Ces clauses priment sur toute considération UX.

# 1. Définition normative d’un Interaction Contract

## 1.1 Définition

Un Interaction Contract est la formalisation canonique du flux :

UI Action → Intent → Command → (Kernel) → TransactionReceipt | CommandError → Projection Update

Il définit :
- la responsabilité de chaque couche,
- les garanties de déterminisme,
- les règles de feedback UX,
- les invariants de cohérence post-commit.

L’UI n’a aucune autorité ontologique.  
Seul le TransactionReceipt (ou CommandError final) fait foi.

---

## 1.2 Pipeline canonique

### Étape 1 — UI Action

Action interactionnelle (click, drag, edit, delete, commit overlay, etc.).

L’UI MAY produire un effet visuel immédiat non canonique (overlay local), mais :

> Aucun effet n’est tenu pour réel avant réception d’un TransactionReceipt.

---

### Étape 2 — Intent

Transformation de l’action en Intent structuré (UX-level).  
L’Intent ne modifie rien. Il décrit l’intention utilisateur.

---

### Étape 3 — Command

L’Intent est converti en Command canonique conforme à Command API v1.

Exigences :
- idempotencyKey obligatoire
- scope explicite (graphSpaceId, plane)
- requireGraphCursor si nécessaire
- aucune mutation implicite

---

### Étape 4 — Exécution Kernel

Kernel applique :
- PermissionCheck (allow | deny | mask)
- Lock acquisition (pessimiste)
- Preconditions
- Validation (Type / contraintes)
- Commit EventStore (tx-closed strict)

Sortie :
- TransactionReceipt (committed)
- ou CommandError (rejected)

---

### Étape 5 — Receipt Handling

UI MUST :
- considérer uniquement le résultat final (jamais un ack transport)
- appliquer entityIdMap si fourni
- mettre à jour son curseur local vers cursorAfter

---

### Étape 6 — Projection Update

La vue est mise à jour via Sync (poll/subscribe) + Projection Engine.

Invariants :
- tx-closed strict
- ordre intra-transaction : meta → graph
- cursors monotones filtrés par principal

---

# 2. Sémantique canonique des actions du Graph Editor

Toutes les actions suivantes DOIVENT respecter pessimistic locking, idempotence, mask non révélateur.

---

## 2.1 Création de Node

### Mode recommandé : via Overlay

1. AddNode(tempId, TypeID, props) dans DeltaSet
2. Affichage immédiat (OverlayGraphView)
3. Commit Overlay → Command
4. Receipt → entityIdMap(tempId → realId)

### Mode direct (cas atomique)

Submit Command create.

UX règle :
- ne jamais considérer l’ID réel avant receipt
- rollback visuel si rejet

---

## 2.2 Création d’Edge

Identique à node.

Contrainte :
- si endpoints masqués → comportement mask non révélateur
- aucun hint d’existence indirect

---

## 2.3 Édition de propriété

Deux modes :

### a) Overlay edit (recommandé)
- UpdateProps dans DeltaSet
- preview locale
- commit explicite

### b) Command directe (patch atomique)
- Submit
- attendre receipt

En cas de :
- VALIDATION → afficher reasonCode
- CONFLICT → resource busy
- PRECONDITION → divergence
- PERMISSION deny → visible mais interdit
- PERMISSION mask → indistinguable NOT_FOUND

---

## 2.4 Suppression

Semantique :
- delete = Command explicite
- locks requis sur toutes les entités affectées
- suppression multi-entités = transaction unique

Aucun merge automatique si conflit.

---

## 2.5 Multi-sélection / Bulk edit

Règles normatives :
- La Command DOIT inclure toutes les cibles explicitement.
- Les locks DOIVENT être acquis sur toutes les cibles avant commit.
- L’échec sur une seule cible entraîne le rejet global (aucune application partielle autorisée).
- L’UI MUST refléter un résultat atomique (succès total ou échec total).

Il est interdit d’implémenter une application partielle silencieuse.

Remédiations autorisées :
- attendre puis retry (même idempotencyKey si strict retry),
- abandonner,
- recréer un overlay sur base stable.

---

## 2.6 Drag / Reconnect

Interprété comme :
- suppression edge
- création edge
ou update relation

Toujours transaction unique.

Overlay recommandé pour UX fluide.

---

## 2.7 Overlay edit / commit / discard

### Edit
- Lock overlay-level exclusif obligatoire.
- DeltaSet modifiable uniquement si overlay.status = draft.

### Commit (workflow strict)
1. Vérifier overlay.status = draft.
2. resolveRevision(baseGraphRevision).
3. Exiger currentGraphSeq == graphSeqBase.
4. Acquérir locks Graph sur toutes les cibles réelles.
5. Submit Command.
6. Attendre TransactionReceipt.
7. Appliquer entityIdMap exhaustif.

Toute divergence entraîne PRECONDITION.CURSOR_MISMATCH.
Aucun rebase automatique n’est autorisé en v1.

### Discard
- Suppression overlay.
- Aucune mutation Graph.

---

# 3. Comportement UX sous conditions système

## 3.1 Lock actif

User-safe :
- message générique (ex: "resource busy")
- aucune identité d’owner
- aucune indication permettant d’inférer l’existence sous mask

Admin-safe (surface restreinte) :
- diagnostics lock autorisés
- masked=true possible

Il est interdit de différencier visuellement :
- "cible inexistante"
- "cible masquée"
- "cible verrouillée mais masquée"

---

## 3.2 Mask

Mask implique :
- UI traite l’entité comme inexistante
- aucune différence visuelle détectable
- Placeholder minimal si projection dérivée

---

## 3.3 Conflit de révision (PRECONDITION.CURSOR_MISMATCH)

UI DOIT :
- indiquer divergence
- proposer : recharger / recréer overlay
- jamais auto-rebase

---

## 3.4 Violation de contrainte

Niveau 1/2 (sync) :
- feedback immédiat

Niveau 3 (async) :
- statut pending/running/ok/violations
- publication bloquée si non OK

---

# 4. Mapping reasonCode → feedback UI

## 4.1 Catégories

- VALIDATION
- PERMISSION (deny | mask)
- CONFLICT
- PRECONDITION
- NOT_FOUND
- INTERNAL

---

## 4.2 Règles de présentation

User-safe :
- afficher category
- afficher reasonCode
- afficher retryable si disponible
- jamais exposer détails internes

Admin-safe :
- masked=true
- diagnostics lock
- authorize decision

Règle : surface → niveau de détail uniforme.

---

# 5. Modèle Undo / Redo

## 5.1 Principe

Undo/Redo respecte append-only strict.

Deux niveaux :

### a) Overlay (non ontologique)
- Undo = modification locale du DeltaSet.
- Aucun effet sur EventStore.

### b) Graph (ontologique)
- Undo = nouvelle Command compensatoire.
- Aucun événement existant n’est supprimé.
- Toute compensation nécessite un TransactionReceipt.

Il est interdit d’implémenter un undo qui efface ou altère l’histoire canonique.

---

# 6. Synchronisation UI

## 6.1 Latence

UI MAY montrer état optimiste via overlay.

Mais MUST :
- distinguer preview vs committed
- invalider si receipt rejet

---

## 6.2 Commit confirmé

Une vue est considérée "à jour" uniquement lorsque :
- un TransactionReceipt a été reçu,
- cursorAfter exposé est admissible (tx-closed),
- la barrière de cohérence choisie est satisfaite (ordre meta puis graph intra-transaction).

Aucun ack transport ne peut être interprété comme confirmation canonique.

---

## 6.3 Subscribe + Poll

Subscribe = best-effort  
Poll = source de vérité

Règles normatives supplémentaires :
- Le curseur utilisé par l’UI DOIT être celui exposé au principal (curseur filtré), jamais un curseur global supposé.
- Aucun écart de séquence ne DOIT être interprété comme preuve d’existence d’une transaction masquée.
- En cas de cursor mismatch côté client, l’UI DOIT déclencher un poll complet depuis son dernier curseur durablement appliqué.

UI MUST :
- dédupliquer events (eventId)
- respecter ordre par stream
- appliquer meta puis graph intra-transaction
- ne jamais marquer la vue comme cohérente si la barrière tx-closed n’est pas satisfaite

---

# 7. Invariants interactionnels Invariants interactionnels

1. Aucune inférence via UI (mask strict).
2. Aucun état partiel visible (tx-closed).
3. Projection ≠ vérité.
4. Receipt seul valide commit.
5. Locks jamais révélateurs.
6. Undo respecte append-only.
7. Aucune mutation implicite.
8. Cache jamais cross-principal.
9. Toute multi-opération = atomique.
10. Cursor visible toujours filtré par principal.
11. Aucune tentative de comparaison directe baseGraphRevision vs graphSeq côté UI.

Ces invariants sont obligatoires pour toute implémentation de l’éditeur.

# 8. Limites assumées v1

1. Pas de merge concurrent.
2. Pas de rebase overlay automatique.
3. Pas d’optimistic commit offline.
4. Pas de co-édition fine overlay.
5. Pas d’ordre total inter-stream.

---

# 9. Résumé

Interaction Contracts v1 formalise :

- la grammaire d’interaction UI → Command → Receipt → Projection
- la sémantique stricte des actions du Graph Editor
- le mapping reasonCode → UX
- la compatibilité avec pessimistic locking
- la cohérence avec tx-closed strict
- la non-fuite sous mask
- la stabilité interactionnelle

L’éditeur Mesh Explorer devient un interprète fidèle du moteur événementiel.

Sans magie.
Sans raccourci.
Sans trahison des invariants.


------------------------------------------------------------------------

## Source: navigation_workspace_ux_model_v_1.md

# Navigation & Workspace UX Model v1

Version: 1.0  
Status: Normatif  
Scope: Modèle canonique de navigation et d’expérience Workspace — Mesh Explorer v1

Strictement compatible avec :
- Workspace / Project / Packaging v1
- Identity & Addressing v1 (adressage racine par graphSpaceId)
- Sync / Transport Layer v1
- Collaboration Model v1 (locks pessimistes, sessions, overlays)
- Security Hardening v1 (mask non révélateur, tx-closed strict, curseurs filtrés)
- Application Layer Foundations v1
- Interaction Contracts & Editor Semantics v1

Ce document ne redéfinit aucune couche système ; il fixe les obligations UX et les transitions d’état côté application.

---

# 0. Préambule normatif — Boucle d’orchestration UI (rappel contractuel)

## 0.1 Principe receipt-only

L’application MUST traiter **TransactionReceipt / CommandError** comme unique verdict final.  
Aucun ack transport, aucun état local, aucune projection cache ne constituent une confirmation canonique.

## 0.2 Sync comme mécanisme de cohérence

- Poll est la source de vérité ; Subscribe est best-effort.
- L’UI MUST dédupliquer les events (at-least-once).
- L’UI MUST appliquer meta puis graph intra-transaction.
- L’UI MUST déclarer une vue « cohérente » uniquement sur un curseur **admissible tx-closed**.

## 0.3 Curseurs exposés et non-fuite

- L’UI MUST utiliser le curseur exposé au principal (curseur filtré), jamais un curseur global supposé.
- L’UI MUST NOT interpréter des écarts de progression comme preuve d’existence d’entités/transactions masquées.

## 0.4 Scoping strict

Toute action UI, toute projection, toute synchronisation MUST être scoped par :
- graphSpaceId (racine canonique)
- principal (visibilité)
- projectionInstance
- plane (graph | overlay)

---

# 1. Définition normative d’un Workspace UX Context

## 1.1 WorkspaceUXContext

Un Workspace UX Context est l’enveloppe applicative minimale garantissant que la navigation et l’état UI restent cohérents et non-fuyants.

Il MUST contenir :

- **principalContext** : sujet + politiques effectives (allow | deny | mask), non révélé au-delà des surfaces autorisées.
- **workspaceRef** : { workspaceId (administratif), graphSpaceId (canonique) }
- **lifecycleState** : active | frozen | archived
- **syncState** : { cursorVisible, connectionState, backlogHint? }
- **activeProjectRef?** : projectId + version (si applicable)
- **activeViewRef** : { projectionSpecId, params, projectionInstanceId }
- **uiState** : état éphémère (sélection, zoom, panneaux)
- **viewPresetRef?** : preset choisi (persisté)
- **overlayContext?** : overlayId + baseGraphRevision + status (si overlay visible)

Propriété : un WorkspaceUXContext n’a aucune autorité ontologique.

---

# 2. Modèle de navigation global

## 2.1 Graphe de navigation canonique

Root → Workspace → Project → View

- Root : liste/accès aux Workspaces (administratif)
- Workspace : univers ontologique complet (graphSpaceId)
- Project : subset dynamique (sans autorité ontologique)
- View : instance de projection (projectionInstance)

## 2.2 Unicité v1 du contexte actif

En v1, l’application MUST maintenir **un seul WorkspaceUXContext actif par surface UI interactive**.

Règles :
- Un changement de Workspace implique un changement de graphSpaceId.
- Toute ProjectionInstance, OverlayContext, Sync cursor et UIState associés à l’ancien graphSpaceId MUST être invalidés à la transition.

Note : la présence de plusieurs Workspaces dans l’environnement (liste, accès) n’implique pas multi-édition simultanée.

---

# 3. Gestion des états UI persistants

## 3.1 UIState (éphémère)

UIState MUST contenir uniquement :
- sélection
- filtres locaux
- zoom/layout local
- panneaux ouverts

UIState MUST NOT :
- contenir des GraphIDs bruts en tant qu’artefacts persistés
- être traité comme canonique après reload

## 3.2 ViewPreset (persisté)

Un ViewPreset est un artefact persisté décrivant :
- projectionSpecId
- paramètres
- layout hints

Contraintes :
- Un ViewPreset MUST NOT embarquer des listes d’EntityRef/IDs canoniques qui deviendraient révélatrices sous mask.
- Tout ciblage d’entités MUST passer par projection (Real/Placeholder selon permissions).

## 3.3 Panel layout

Si plusieurs panels dépendent des mêmes données qu’un Graph View, ils MUST être attachés à la même ProjectionInstance.

Si un panel est alimenté par une projection différente (ou en rattrapage), il MUST afficher explicitement un état « syncing/catching up ».

---

# 4. Ouverture / fermeture / switch de Workspace

## 4.1 Ouvrir Workspace

Pipeline normatif :
1. Résoudre workspaceRef → graphSpaceId (administratif → canonique).
2. Initialiser Sync scope = graphSpaceId.
3. Ouvrir une ProjectionInstance par défaut (ou via ViewPreset).
4. Démarrer poll (source de vérité) et, si disponible, subscribe.
5. Déclarer la vue cohérente uniquement quand le curseur admissible tx-closed est atteint.

## 4.2 Fermer Workspace

À fermeture :
- arrêter subscribe
- persister ViewPresetRef + UIState minimal (si configuré)
- invalider ProjectionInstance et caches filtrés
- libérer overlays locaux UI (sans toucher au canon)

## 4.3 Switch Workspace

Un switch est équivalent à :
- fermer contexte courant
- ouvrir nouveau contexte

L’UI MUST NOT tenter de transférer :
- selection par GraphID
- overlayId
- locks/sessions

---

# 5. Restauration d’état

## 5.1 Reload / crash recovery

Au reload :
1. Restaurer uniquement les artefacts persistables (ViewPreset, UI preferences).
2. Recalculer la vue via poll depuis un curseur durablement stocké (si présent), sinon depuis un point d’entrée système.
3. Reconstruire UIState de manière best-effort à partir des sorties de projection.

Il est interdit de considérer une sélection/restauration fondée sur des IDs bruts comme preuve d’existence sous mask.

## 5.2 Deep-linking

Un deep-link MAY adresser :
- workspace (administratif)
- projectId (si accessible)
- view preset / projection params
- une cible logique (ex: filtre/projection), jamais une garantie d’accès à une entité.

Si la résolution d’un deep-link implique une entité masquée/inaccessible :
- l’expérience user-safe MUST être indistinguable d’un NOT_FOUND.
- l’UI MUST retomber sur une navigation stable (workspace root ou vue par défaut), sans indiquer la cause.

---

# 6. Comportements UX sous conditions système

## 6.1 Entité masquée

- Toute navigation « vers une entité » est une navigation vers une vue/projection.
- Une entité masquée MUST apparaître comme inexistante (ou Placeholder minimal via projection), sans fuite.

## 6.2 Workspace inaccessible

- Workspace inexistant vs workspace masqué MUST être indistinguables user-safe.
- Workspace deny (visible mais interdit) MAY être présenté comme interdit, sans détails révélateurs.

## 6.3 Conflit de version / migration requise

Si une incompatibilité Meta non migrable est détectée :
- l’ouverture MUST être rejetée.
- l’UI MUST présenter un état bloquant explicite (migration requise) sans tenter de correction silencieuse.

## 6.4 Perte de connexion / reprise Sync

- Déconnexion : la vue MAY rester affichée avec un statut « offline / stale ».
- Reprise : l’UI MUST reprendre par poll à partir du dernier curseur durablement appliqué.
- L’UI MUST tolérer la redelivery (dédup) et ne jamais présenter un état partiel (tx-closed).

---

# 7. Intégration des locks et overlays dans la navigation

## 7.1 Overlays

- Un overlay est scoped à un graphSpaceId.
- L’UI MAY permettre l’ouverture d’un overlay depuis une vue (draft workflow).
- À switch Workspace, tout overlayContext MUST être fermé/invalide (pas de transfert inter-scope).

## 7.2 Locks

- Les locks sont des leases (TTL) et ne sont pas des « réservations longue durée ».
- L’UI MAY maintenir un uiSessionId pour heartbeat si applicable.
- L’UI MUST afficher des indicateurs user-safe non révélateurs.

---

# 8. Invariants UX globaux

1. Pas d’inférence via navigation (mask strict, indistinguabilité absent/masqué).
2. Cohérence visuelle post-commit : aucune transaction partielle observable.
3. Stabilité de navigation : tout deep-link invalide retombe sur un état stable sans révéler la cause.
4. Scope strict : aucun artefact UI d’un graphSpaceId ne fuit vers un autre.
5. Cache scoping : aucun cache/projection filtré servi cross-principal.
6. ViewPreset non révélateur : pas de listes d’IDs persistées comme vérité.
7. Subscribe best-effort ; Poll source de vérité ; dédup obligatoire.

---

# 9. Limites assumées v1

1. Pas de multi-édition simultanée multi-workspaces sur une même surface UI (un contexte actif).
2. Pas de federation d’URI inter-workspaces (adressage racine = graphSpaceId).
3. Pas de rebase overlay automatique.
4. Pas de restauration forte d’overlay après crash si la base a divergé (workflow utilisateur requis).
5. Pas d’offline optimistic commit.

---

# 10. Résumé

Navigation & Workspace UX Model v1 définit :
- un WorkspaceUXContext canonique
- un modèle root→workspace→project→view
- les règles de persistance UI (UIState vs ViewPreset)
- les transitions open/close/switch
- la restauration (reload/deep-link) non-fuyante
- l’intégration locks/overlays

But : garantir une navigation stable, non révélatrice et compatible avec les invariants systémiques.

------------------------------------------------------------------------

## Source: inspection_operator_ux_v_1.md

# Inspection_Operator_UX_v1

Version: 1.0  
Status: Normatif  
Scope: Modèle UX canonique d’inspection, d’explication et d’opération (Mesh Explorer)

---

# 0. Positionnement

Inspection & Operator UX v1 formalise les surfaces permettant de :

- inspecter l’état ontologique (Graph / Meta / Projection / Overlay),
- expliquer une décision (validation, permission, lock, precondition),
- diagnostiquer projection, sync et collaboration,
- opérer le système sans introduire de fuite sous `mask`.

Ce document :
- ne redéfinit aucune couche système,
- s’appuie strictement sur Ontological Inspection Protocol, Permissions, Security Hardening v1, Observability & Auditability v1, Projection Engine v1, Sync v1, Collaboration v1,
- distingue explicitement surfaces **user-safe** et **admin-safe**.

Objectif : rendre le système explicable sans le rendre fuyant.

---

# 1. Surfaces d’inspection normatives

Trois niveaux canoniques sont définis.

## 1.1 User-Safe Inspection Surface (USI)

Accessible à tout sujet disposant d’un droit `read` sur la cible.

Caractéristiques :

- Respect strict de `allow | deny | mask`.
- Aucune fuite d’existence.
- Aucune révélation d’EntityRef masquée.
- Curseurs filtrés par principal.

Expose uniquement :

- OntologicalStatus (Real / Derived / Overlay / Placeholder)
- TypeInfo minimal
- Permissions effectives (allow / deny, jamais mask explicite)
- reasonCode si rejet
- retryable (si disponible)

Invariant :

USI MUST être indistinguable entre :
- entité absente
- entité existante mais masquée

---

## 1.2 Surfaces Admin-safe (rôle-gated)

Le système ne définit pas une nouvelle sémantique entre user-safe et admin-safe : toute exposition « opérateur » est un **profil d’accès** à une surface **admin-safe**.

Deux profils usuels (sans nouvelle ontologie) :

- **Operator** : admin-safe « minimal », orienté diagnostics opérationnels.
- **Admin** : admin-safe « complet », orienté sécurité / engineering.

Caractéristiques communes (normatives) :

- Accès contrôlé et journalisé.
- Peut exposer `masked=true`, `txId`, `eventRefs`, `projectionRunId`, diagnostics lock, invalidationReasons.
- MUST appliquer `deny-wins` et respecter `mask` : aucune donnée révélatrice ne peut être exposée à un sujet qui n’y est pas autorisé.

Règle : si un opérateur n’a pas le droit de connaître une cible/trace (cas `mask` vis-à-vis de l’opérateur), sa vue admin-safe MUST rester non-fuyante et indistinguable d’un NOT_FOUND.

---

## 1.3 Admin-Safe Inspection Surface (ASI)

Surface restreinte.

Peut exposer :

- masked=true explicite
- txId
- eventRefs
- projectionRunId
- invalidationReasons
- diagnostics lock détaillés
- resolveRevision diagnostics

Contraintes :

- Accès contrôlé.
- Accès journalisé.
- Toute donnée révélatrice MUST rester dans ASI.

---

# 2. Modèle UX de l’Inspector

L’Inspector est structuré en sections normatives.

## 2.1 Section A — Ontologie

Affiche :

- OntologicalStatus
- identity (si autorisé)
- typeInfo
- scopeInfo
- overlayContext (si applicable)

Règles :

- Placeholder n’expose jamais de GraphID.
- Derived MUST exposer provenance (user-safe).
- Overlay MUST indiquer non-vérité.

---

## 2.2 Section B — Permissions

Affiche :

- Actions autorisées (read/traverse/update/delete/commit)
- Actions refusées (deny) avec reasonCode

Ne doit jamais :

- révéler qu’un deny cache une entité masquée.

---

## 2.3 Section C — Provenance (OIR)

### 2.3.1 Principe

La provenance est une explication de **construction de vue**.
Elle ne doit jamais reconstituer une cible masquée par ricochet.

### 2.3.2 Exposition par surface

**User-safe** (USI) :
- `projectionId`
- `paramsHash`
- `steps` (trace coarse)

**Admin-safe** (ASI) :
- `projectionRunId`
- `eventCursorBefore/After` (dans le scope de visibilité du principal consultant)
- `logicalSnapshotRef`
- `invalidationReasons`

### 2.3.3 Règle de masquage de provenance (normative)

Si une entité ou un artefact est rendu **Placeholder** du fait d’un `mask` :

- La section Provenance **MUST NOT** révéler de dépendances ou d’artefacts permettant d’inférer l’existence d’une cible masquée.
- En **user-safe**, la Provenance **MUST** être :
  - soit **absente** (section non affichée),
  - soit réduite à un libellé générique non différenciant (ex. “restricted”).

Règle : la provenance d’un Derived masqué est elle-même masquée.

### 2.3.4 Redaction Rules

- Toute provenance incluant `EntityRef`, `GraphID`, `EdgeID`, `eventId` ou `txId` MUST être filtrée hors user-safe.
- Aucun `eventId` masqué ne peut apparaître en USI.

---

## 2.4 Section D — Runtime & Sync — Runtime & Sync

Affiche :

- cursor local (filtré)
- état sync (up-to-date / catching-up)
- lag agrégé

Ne doit jamais exposer :

- graphSeq global si non visible
- trous de séquence révélateurs

---

## 2.5 Section E — Diagnostics (conditionnel)

Visible si erreur ou divergence.

Expose (selon surface) :

- category
- reasonCode
- retryable
- masked (OPI/ASI uniquement si autorisé)

---

# 3. Explication des refus et échecs

## 3.1 Principe

Toute erreur affichée doit être expliquable via :

- category
- reasonCode stable
- contexte minimal

Jamais via message implicite révélateur.

---

## 3.2 Mapping category → UX

VALIDATION  
→ afficher violation structurée

PERMISSION  
→ afficher deny user-safe  
→ mask = indistinguable NOT_FOUND

CONFLICT  
→ afficher resource busy

PRECONDITION  
→ afficher divergence base revision

---

## 3.3 ExplainReceipt (UX contract)

Surface admin peut produire :

- commandId
- decision
- txId
- cursorAfter
- projectionRuns associés

Version user-safe = sous-ensemble filtré.

---

# 4. Diagnostic des projections

## 4.1 Déterminisme

L’UX MUST pouvoir afficher :

- mode (delta | rebuild | recovery)
- eventCursorBefore/After
- logicalSnapshotRef

Admin-safe :
- comparer incremental vs rebuild
- signaler divergence

---

## 4.2 Invalidation

InvalidationReasons MUST être exposées (OPI/ASI) sous forme :

- EVENT_GAP
- LOGICAL_SNAPSHOT_CHANGED
- SNAPSHOT_CORRUPT
- SCHEMA_VERSION_MISMATCH
- MANUAL_REBUILD
- INTERNAL_ERROR

User-safe = indication générique “rebuilding”.

---

## 4.3 Rebuild vs Incremental

L’UX opérateur doit distinguer :

- cache valide
- cache invalidé
- rebuild en cours

Sans exposer d’EntityRef non autorisée.

---

# 5. Diagnostic Sync

## 5.1 Cursor

Afficher uniquement :

- cursor filtré
- progression monotone

Interdit :

- exposer graphSeq global
- exposer seq non visible

---

## 5.2 Lag

Afficher :

- meta lag (agrégé)
- graph lag (agrégé)

Pas de lag par entité.

---

## 5.3 Reprise

En cas de mismatch :

- afficher état resync
- jamais révéler event manquant spécifique

---

# 6. Diagnostic Collaboration

## 6.1 Locks

User-safe :
- “resource busy”

Operator-safe :
- lock acquired
- ttl restant

Admin-safe :
- owner
- targets

---

## 6.2 Staleness

Afficher :

- PRECONDITION.CURSOR_MISMATCH
- baseGraphRevision résolue (OPI/ASI)

---

## 6.3 resolveRevision

Toute erreur MUST être non révélatrice en USI.

ASI peut distinguer :
- revision inconnue
- revision non autorisée

---

# 7. Invariants UX de non-inférence

UX-INS-1 — Aucune surface ne permet de distinguer :
- absent vs masqué

UX-INS-2 — Aucune surface ne révèle tx partielle.

UX-INS-3 — Aucune métrique exposée ne segmente par entité.

UX-INS-4 — Toute Derived dépendant d’une entité masquée est masquée.

UX-INS-5 — Aucun cache cross-principal.

UX-INS-6 — Toute transaction touchant cible masquée est omise intégralement.

---

# 8. Stabilité UX

## 8.1 Stabilité des reason codes

Les reason codes sont normatifs et stables.

L’UX ne dépend jamais d’un message humain.

---

## 8.2 Stabilité des sections Inspector

L’Inspector conserve les sections A–E, même si certaines sont vides.

Pas d’interface adaptative révélatrice.

---

# 9. Limites assumées v1

1. Pas d’explication causale complète inter-stream.
2. Pas de timeline interactive des tx.
3. Pas d’analyse différentielle multi-principaux.
4. Pas de debug projection cross-context en surface user-safe.
5. Pas de rebase overlay automatique.

---

# 10. Résumé

Inspection & Operator UX v1 garantit :

- explicabilité structurée
- cohérence avec tx-closed
- respect strict de mask
- diagnostics projection/sync/collaboration
- séparation nette user-safe / operator / admin-safe

Le système devient inspectable.
Sans fuite.
Sans magie.
Sans contredire ses invariants.


------------------------------------------------------------------------

## Source: application_cohesion_audit_v_1.md

# Application Cohesion Audit v1

Version: 1.0  
Status: Audit analytique  
Scope: Cohérence couche applicative (6.x) ↔ invariants systémiques (4.x, 5.x)

---

# 0. Objectif

Vérifier que la couche Application (6.0–6.3) n’introduit :
- aucune violation d’invariant système,
- aucune autorité ontologique implicite,
- aucune fuite de sécurité,
- aucune incohérence transactionnelle,
- aucune dérive de synchronisation.

Ce document n’introduit aucune nouvelle spécification. Il vérifie la compatibilité stricte.

---

# 1. Invariants systémiques impactant la couche applicative

Les invariants suivants contraignent directement l’Application Layer :

1. Projection ≠ Vérité  
2. tx-closed strict  
3. deny-wins  
4. mask non révélateur  
5. séparation meta / graph  
6. overlay non ontologique  
7. idempotence Command  
8. pessimistic locking  
9. curseurs filtrés par principal  
10. append-only (undo compensatoire uniquement)

L’audit ci-dessous vérifie leur respect.

---

# 2. Vérification couche par couche

## 2.1 6.0 — Foundations

### Projection ≠ Vérité

Application définie explicitement comme orchestrateur UX.  
Aucune écriture hors Command → Kernel.  
Receipt-only truth respecté.

Évaluation : Conforme.

---

### tx-closed strict

UI ne considère un état cohérent que sur cursor admissible.  
Subscribe best-effort, Poll source de vérité.  
Aucune confirmation basée sur ack transport.

Évaluation : Conforme.

---

### Séparation meta / graph

Barrières de cohérence explicites.  
Application intra-transaction meta puis graph.

Évaluation : Conforme.

---

### Overlay non ontologique

OverlayGraphView utilisé uniquement comme preview.  
Commit explicite requis.

Évaluation : Conforme.

---

## 2.2 6.1 — Interaction Contracts

### Command API / Idempotence

- idempotencyKey obligatoire
- Retry strict = même résultat final
- Aucun effet partiel autorisé

Évaluation : Conforme.

---

### Pessimistic locking

- Lock acquisition côté Kernel
- UI interprète seulement receipts/errors
- Aucun lock décidé côté UI

Évaluation : Conforme.

---

### PRECONDITION (cursor mismatch)

- Aucun auto-rebase
- Échec explicite
- Remédiation UX contrôlée

Évaluation : Conforme.

---

### Undo append-only

- Overlay: local
- Graph: Command compensatoire uniquement

Évaluation : Conforme.

---

## 2.3 6.2 — Navigation & Workspace

### Scope strict (graphSpaceId)

WorkspaceUXContext impose scoping strict.  
Aucun artefact transféré inter-workspace.

Évaluation : Conforme.

---

### Curseurs filtrés

UI utilise exclusivement curseur exposé au principal.  
Aucune inférence via trous de séquence.

Évaluation : Conforme.

---

### Deep-linking non révélateur

Absence vs masqué indistinguable.  
Fallback navigation stable.

Évaluation : Conforme.

---

## 2.4 6.3 — Inspection & OIR

### Statut ontologique inspectable

Real / Derived / Overlay / Placeholder toujours visible.

Évaluation : Conforme.

---

### Mask non révélateur

- Placeholder minimal
- Aucun GraphID exposé
- Lock indicator user-safe

Évaluation : Conforme.

---

### Derived dépendances masquées

Derived masqué intégralement si dépendance masquée.

Évaluation : Conforme.

---

# 3. Analyse des flux bout-en-bout UI

## 3.1 Action utilisateur → Intent → Command → Event → Projection → Feedback

Pipeline strict respecté :

- Aucun write hors Command
- Receipt unique verdict
- Sync par curseur admissible
- Projection read-only

Aucune rupture d’invariant détectée.

---

## 3.2 Cas mask

Scénario : action sur entité masquée

Comportement requis :
- Réponse indistinguable NOT_FOUND
- Aucun lock révélateur
- Aucun delta partiel observable

Application respecte user-safe vs admin-safe.

Risque : Faible (dépend de discipline implémentation UI).

---

## 3.3 Cas lock

Scénario : ressource verrouillée

- Rejet CONFLICT
- Message générique
- Pas d’identité owner

Transaction partielle impossible.

Risque : Faible.

---

## 3.4 Cas conflit revision

Scénario : baseGraphRevision divergente

- PRECONDITION.CURSOR_MISMATCH
- Aucun rebase automatique

Conforme pessimistic locking + déterminisme.

Risque : Aucun.

---

## 3.5 Cas violation contrainte

Niveau 1/2 : synchro  
Niveau 3 : async statut

Aucune mutation implicite.  
Aucun contournement commit-time.

Risque : Acceptable (complexité UX uniquement).

---

# 4. Surfaces de fuite potentielles via UX

## 4.1 Différenciation absent vs masqué

Mitigations présentes :
- user-safe uniforme
- placeholder minimal

Risque : Critical si implémentation divergente.  
Statut actuel : Conforme spécification.

---

## 4.2 Caches cross-principal

Spécification interdit partage de projection filtrée.  

Risque : Structural si mal implémenté.  
Statut spécifié : Conforme.

---

## 4.3 Indicateurs lock révélateurs

User-safe obligatoire.  
Admin-safe restreint.

Risque : Critical si UI expose owner.

---

## 4.4 ViewPreset révélateur

Interdiction d’embarquer EntityRef persistés.  

Risque : Structural.

---

# 5. Classification des risques

## Critical (si mal implémenté)

- Fuite sous mask via UI
- Cursor non filtré exposé
- Cache cross-principal
- Lock indicator révélateur
- Transaction partielle affichée

## Structural

- Mauvaise gestion ViewPreset
- Confusion preview vs committed
- Barrière cohérence non respectée

## Acceptable

- Complexité UX sous contraintes async
- Gestion retry utilisateur

---

# 6. Recommandations correctives

1. Tests spécifiques UI pour indistinguabilité absent vs masqué.
2. Tests sur indicateurs lock user-safe.
3. Tests de barrière cohérence meta→graph côté UI.
4. Vérification absence de cache cross-principal.
5. Golden tests projection attachée à curseur filtré.

---

# 7. Conclusion

La couche applicative v1 est cohérente avec :

- séparation ontologique
- tx-closed strict
- pessimistic locking
- deny-wins
- mask non révélateur
- déterminisme par replay

Aucune contradiction structurelle détectée.

La robustesse dépend désormais :
- de la discipline d’implémentation UI,
- de la conformité aux tests de sécurité et de synchronisation.

Application ne trahit pas les invariants système.

Statut : Cohésion validée (v1).


------------------------------------------------------------------------

## Source: application_conformance_alignment_audit_v_1.md

# Application ↔ Conformance Test Alignment Audit v1

Version: 1.0  
Status: Audit analytique (alignement testabilité)  
Scope: Couche applicative (6.0–6.3) ↔ Conformance Test Model v1  

---

# 0. But de l’audit

Vérifier que :

1) chaque invariant applicatif (UX et contrats d’interaction) est **réductible à des invariants globaux** (I-01..I-15) et/ou de hardening (INV-SH-*),
2) chaque invariant est **testable** via au moins un oracle A/B/C/D,
3) les zones à haut risque côté UI ont des tests **Critical** explicites (pas “implicitement couverts”).

Ce document n’écrit pas des specs. Il produit une matrice de preuve testable.

---

# 1. Rappels (référentiels)

## 1.1 Oracles Conformance (rappel)

- **Oracle A — Receipt/Errors** : receipts/erreurs (structure + reasonCode).
- **Oracle B — Replay/StateDump** : reconstruction déterministe (EventStore → état).
- **Oracle C — Projection/ViewModel** : ViewModel normalisé, provenance, OIR, placeholders.
- **Oracle D — Security/Non‑fuite** : indistinguabilité et absence de canaux latéraux.

## 1.2 Axes applicatifs audités

- **6.0 Foundations** : primitives UI, receipt-only truth, cohérence cursor.
- **6.1 Interaction Contracts** : Intent→Command, handling receipts/errors, editor semantics.
- **6.2 Navigation & Workspace** : scoping graphSpaceId, curseurs filtrés, deep-link.
- **6.3 Inspection & OIR** : ontological status, placeholders, filtering.

---

# 2. Matrice d’alignement (Application → Invariants → Oracles → Sévérité)

## 2.1 Fondations (6.0)

### A-UX-01 — Receipt-only truth

- **Invariant(s)** : I-07 (non-magie), I-10 (idempotence), I-04 (tx-closed, via “pas d’état supposé”).
- **Oracles** : A (receipt final), B (pas d’effets en cas de rejet).
- **Sévérité** : **Critical**.

### A-UX-02 — Projection ≠ Vérité (UI read-only)

- **Invariant(s)** : I-01 (séparation ontologique), I-13 (snapshots non canoniques).
- **Oracles** : C (ViewModel), B (rebuild vs cache).
- **Sévérité** : Structural (devient **Critical** si une surface présente la vue comme canon).

### A-UX-03 — tx-closed perceptible (pas de transaction partielle visible)

- **Invariant(s)** : I-04 (tx-closed), I-05 (meta→graph intra-tx).
- **Oracles** : B (lecture ranges / tx), C (ViewModel cohérent), D (pas d’observable partiel).
- **Sévérité** : **Critical**.

### A-UX-04 — Cursors visibles filtrés par principal

- **Invariant(s)** : I-11 (mask non-fuyant), INV-SH-3 (curseurs filtrés), SH-CURSOR-1.
- **Oracles** : D (pas de trous observables), A (cursorAfter admissible), B (progression monotone).
- **Sévérité** : **Critical**.

### A-UX-05 — Cache scoping (pas de cache cross-principal)

- **Invariant(s)** : I-11, I-13, INV-SH-? (règle hardening cache scoping).
- **Oracles** : D (absence de fuite via cache), C (mêmes entrées ⇒ mêmes sorties par principal), B (invalidable vs replay).
- **Sévérité** : **Critical** si exposé ; sinon Structural.

---

## 2.2 Interaction Contracts (6.1)

### A-IC-01 — Intent→Command conforme (idempotencyKey, scope explicite)

- **Invariant(s)** : I-10 (idempotence), I-14 (adressage/scope), I-07.
- **Oracles** : A (même commande ⇒ même résultat), B (pas de doubles effets).
- **Sévérité** : **Critical**.

### A-IC-02 — Atomicité UX (multi-cibles = succès total ou échec total)

- **Invariant(s)** : I-04 (tx-closed), I-07 (pas d’effets partiels), I-09 (locking).
- **Oracles** : A (receipt unique), B (replay = aucune mutation partielle), C (UI reflète un seul verdict).
- **Sévérité** : **Critical**.

### A-IC-03 — Pessimistic locking (pas de merge concurrent)

- **Invariant(s)** : I-09.
- **Oracles** : A (CONFLICT / reasonCode), B (un seul commit).
- **Sévérité** : **Critical**.

### A-IC-04 — PRECONDITION (cursor mismatch) sans auto-rebase

- **Invariant(s)** : I-15 (resolveRevision), I-09 (overlay commit strict), I-10.
- **Oracles** : A (PRECONDITION/CURSOR_MISMATCH), B (aucun effet), D (erreur non révélatrice si masqué).
- **Sévérité** : Structural (devient **Critical** si l’UI “bricole” un rebase implicite).

### A-IC-05 — Undo append-only (Graph = Command compensatoire)

- **Invariant(s)** : I-02 (append-only), I-07.
- **Oracles** : B (event log append-only), A (undo = nouvelle Command).
- **Sévérité** : Structural.

---

## 2.3 Navigation & Workspace (6.2)

### A-NAV-01 — Scope strict graphSpaceId, invalidation à la transition

- **Invariant(s)** : I-14 (adressage par scope), I-11 (anti-fuite via cross-scope).
- **Oracles** : A (scoping), D (pas de fuite via résidus UI), C (view models séparés).
- **Sévérité** : Structural (peut devenir Critical si cross-workspace leak possible).

### A-NAV-02 — Deep-link non révélateur

- **Invariant(s)** : I-11 (mask), SH-REV-1 (résolution non révélatrice).
- **Oracles** : D (indistinguabilité absent vs masqué), A (erreurs non révélatrices).
- **Sévérité** : **Critical**.

### A-NAV-03 — Panels attachés à la même ProjectionInstance (cohérence d’instant)

- **Invariant(s)** : I-01, I-04 (pas de “faux instant cohérent”).
- **Oracles** : C (ProjectionInstanceId / cursor exposé), A (metadonnées d’état syncing).
- **Sévérité** : Structural.

---

## 2.4 Inspection & OIR (6.3)

### A-OIR-01 — OntologicalStatus toujours visible

- **Invariant(s)** : I-01.
- **Oracles** : C (OIR / ViewModel).
- **Sévérité** : Structural.

### A-OIR-02 — Placeholder non révélateur (pas de GraphID, hint générique)

- **Invariant(s)** : I-11, INV-SH-2.
- **Oracles** : C (shape placeholder), D (indistinguabilité).
- **Sévérité** : **Critical**.

### A-OIR-03 — Derived : provenance obligatoire + masquage si dépendance masquée

- **Invariant(s)** : I-01, I-11, INV-SH-7.
- **Oracles** : C (provenance/absence), D (pas d’inférence par derived), B (rebuild vs incremental).
- **Sévérité** : **Critical**.

---

# 3. Zones de test manquantes (gaps probables côté UI)

Cette section liste les points où le Conformance Test Model couvre “le système” mais où l’UI peut réintroduire une violation si elle n’est pas testée explicitement.

## 3.1 Gaps Critical à couvrir par des tests UI dédiés

1) **Indistinguabilité absent vs masqué** sur :
- navigation (deep-link)
- erreurs (NOT_FOUND vs PERMISSION masked)
- locks (locked vs masked)

2) **Curseurs filtrés (principal)** :
- aucun affichage/trace UI ne doit exposer un seq global,
- aucun “gap visible” ne doit être interprétable.

3) **tx-closed perceptible** :
- pas de rafraîchissement UI par morceaux (ex. panneau mis à jour sans le graphe),
- respect meta→graph dans l’application d’événements.

4) **Cache scoping** :
- inter-principal : pas de réutilisation d’un cache filtré,
- inter-workspace : pas de réutilisation d’un cache d’un autre graphSpaceId.

## 3.2 Gaps Structural

- ViewPreset : validation “non révélateur” (pas d’IDs persistés servant de vérité).
- Représentation preview vs committed (overlay indicator) : aucune confusion dans les états UI.

---

# 4. Suite de tests minimale recommandée (Application-focused)

## 4.1 Tests Critical (obligatoires)

### T-APP-CRIT-1 — Receipt-only truth

- Scénario : soumettre une Command, simuler ack transport sans receipt, vérifier que l’UI n’affiche pas “committed”.
- Oracle : A.

### T-APP-CRIT-2 — tx-closed perceptible

- Scénario : provoquer une transaction multi-events ; vérifier que l’UI ne montre jamais un état partiel.
- Oracles : B + C.

### T-APP-CRIT-3 — Mask indistinguability (absent vs masqué)

- Scénarios A/B :
  - A : entité absente
  - B : entité existante mais masquée
- Surfaces : navigation, edit, lock indicator, inspector.
- Oracles : D (+ A).

### T-APP-CRIT-4 — Cursor filtré (pas de trous observables)

- Scénario : transactions masquées intercalées ; vérifier progression monotone et absence de “gaps” interprétables.
- Oracles : D (+ A).

### T-APP-CRIT-5 — Derived dépendance masquée

- Scénario : Derived calculé à partir d’une entité masquée ; vérifier suppression/placeholder stable.
- Oracles : C + D.

### T-APP-CRIT-6 — Cache cross-principal

- Scénario : même projection ouverte par deux principals avec visibilités différentes ; vérifier que les caches/outputs ne se contaminent pas.
- Oracles : D + C.

## 4.2 Tests Structural (recommandés)

- T-APP-STR-1 — Panels cohérents (même ProjectionInstance) ou état “syncing”.
- T-APP-STR-2 — ViewPreset non révélateur (aucune liste d’EntityRef persistée comme vérité).
- T-APP-STR-3 — Overlay workflow strict (PRECONDITION / CONFLICT / PERMISSION).

---

# 5. Risques (reclassés selon Conformance)

## Critical

- Violation mask via UI (erreurs/locks/nav/inspector)
- Exposition d’un cursor global / trous observables
- Affichage partiel (non tx-closed)
- Cache cross-principal

## Structural

- Confusion preview/committed
- ViewPreset révélateur
- Panels “faux cohérents” alimentés par projections différentes

## Acceptable

- Complexité UX des contraintes async (L3) tant que le statut est explicite et bloquant

---

# 6. Conclusion

L’Application Layer (6.0–6.3) est **alignée** sur le Conformance Test Model v1 :

- chaque invariant applicatif critique est mappable à I-01..I-15 et/ou INV-SH-* ;
- chaque invariant a une voie de preuve via A/B/C/D ;
- la principale fragilité est la **réintroduction** de fuites/écarts par l’UI (indicateurs, caches, navigation), ce qui exige des tests **Application-focused** explicitement nommés (et pas seulement des tests système).

Statut : Alignement validé, avec suite de tests UI Critical à rendre obligatoire.





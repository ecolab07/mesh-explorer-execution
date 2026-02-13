# Mesh_Product_Strategy_v1

Version: 1.0  
Status: Strategic Product Block Frozen 
Scope: Consolidation of Product Definition → Feasibility → Scope Freeze → Phasing → Acceptance Criteria

---

# Global Introduction

Ce bloc formalise la stratégie produit complète de Mesh Explorer v1 selon une séquence décisionnelle stricte :

1. **Product Definition**  
   Définition claire de ce que le produit est et n’est pas.

2. **Product ↔ Architecture Feasibility Audit**  
   Vérification que le produit est réellement compatible avec les invariants système.

3. **MVP Scope Freeze**  
   Gel explicite du périmètre v1.

4. **Implementation Phasing Plan**  
   Ordre réel d’implémentation discipliné.

5. **MVP Acceptance Criteria**  
   Critères mesurables rendant impossible toute déclaration “terminé” sans preuve.

Ce document consolide intégralement ces cinq blocs sans modification décisionnelle.

---
## Source: product_v_1_definition.md

# Product v1 Definition

Version: 1.0  
Status: Superseded by Mesh_Product_Strategy_v1.md
Scope: Définition produit livrable, strictement compatible avec les spécifications système validées (4.x, 5.x, 6.x)

---

# 1. Positionnement produit v1

## 1.1 Ce que Mesh Explorer v1 est

Mesh Explorer v1 est une application mono-tenant, mono-user, qui rend opérable un GraphSpace événementiel strict et inspectable.

Elle permet :

- d’explorer un Workspace (graphSpaceId) via des projections (Real / Derived / Overlay / Placeholder),
- d’éditer via overlays (Draft/Hypothesis/Annotation) puis commit explicite,
- d’émettre des Commands conformes,
- d’inspecter l’état ontologique et d’expliquer les décisions (validation, permissions, locks, preconditions),
- de migrer un état entre environnements par export/import de snapshot figé.

Le produit respecte et expose les invariants système (append-only, tx-closed strict, deny-wins, mask non révélateur, déterminisme par replay).

### Déploiements v1 (même modèle d’autorité)

Mesh Explorer v1 supporte plusieurs modes de distribution (Desktop et Web/PWA) et plusieurs backends de persistance sélectionnables, sans divergence de modèle d’autorité.

**Verrou v1 — Kernel/Runtime en mode Web/PWA**

- En mode Web/PWA, le **Kernel/Runtime est embarqué côté client** (application chargée côté navigateur). Une fois l’application chargée, l’exécution ne dépend plus d’un serveur applicatif Mesh dédié.
- Toute mutation canonique reste : Command → Kernel → Transaction → EventStore, et la vérité reste receipt-only.

**Backends de persistance (v1)**

- **Local** : base locale (IndexedDB). Peut être utilisée offline.
- **Remote** : persistance distante (ex. Supabase) utilisée comme support d’un EventStore compatible (voir verrou ci-dessous).
- **Sync** : réplication **single-writer** (voir verrou sync).

**Verrou v1 — Remote = EventStore-compatible**

- En mode remote, la persistance distante doit se comporter comme un **EventStore compatible** : append-only, tx-closed, ordre par stream, replay déterministe.
- Le produit n’expose pas de “CRUD libre” sur des états canoniques : l’unique voie d’écriture reste l’append d’événements/transactions (ou équivalent), produisant des receipts.

**Verrou v1 — Sync = single-writer choisi par l’utilisateur**

- En v1, le mode sync n’implique **ni merge**, ni co-édition. Un seul device/instance a le droit d’écrire.
- L’utilisateur choisit explicitement quel device est “writer” (les autres sont lecteurs/réplicas).

**Verrou v1 — Offline en PWA**

- Le commit offline en PWA est autorisé **uniquement** lorsque le backend actif est **Local (IndexedDB)**.
- Quand l’utilisateur est en ligne, il peut choisir de rester en Local, basculer en Remote, ou activer Sync (single-writer).

Mesh Explorer v1 supporte plusieurs **modes de distribution** (Desktop et Web/PWA) et plusieurs **backends de persistance** sélectionnables, sans divergence de modèle d’autorité.

- **Desktop** : Runtime + EventStore locaux (autorité locale).

- **Web / Online (PWA possible)** : application chargée côté navigateur (client lourd). Une fois l’application chargée, l’exécution ne dépend plus d’un serveur applicatif dédié.

  Backends de persistance supportés (v1) :
  - **Local** : base locale navigateur (ex. IndexedDB), exportable.
  - **Remote** : persistance distante (ex. Supabase) sans serveur applicatif Mesh dédié.
  - **Sync** : mode de synchronisation de persistance **conservé comme option** d’implémentation, mais **en v1** il est interprété comme une synchronisation **sans merge** et **sans co-édition** (single-writer), et ne doit pas être présenté comme une synchronisation continue bidirectionnelle “collaborative”.

---

## 1.2 Ce que Mesh Explorer v1 n’est pas

Mesh Explorer v1 n’est pas :

- un produit collaboratif multi-user en v1 (la possibilité est laissée pour versions futures, sans promesse v1),
- un système de co-édition fine avec merge automatique,
- un outil de synchronisation continue bidirectionnelle Desktop ↔ Online,
- un produit offline-first avec commit optimiste,
- un moteur analytique distribué,
- une plateforme low-code généraliste.

Il ne simplifie pas l’architecture sous-jacente : il l’expose de manière opérable.

---

# 2. Profils utilisateurs cibles v1

## 2.1 Profil A — Modeleur / Éditeur de Graph

Objectif :

- créer et structurer des entités typées,
- établir des relations,
- corriger des propriétés,
- travailler en Draft via overlay avant commit.

Attentes produit :

- visualisation claire (Graph View + Panels),
- inspection ontologique structurée (OIR),
- feedback explicite des erreurs (reasonCode),
- workflow commit strict et explicite.

---

## 2.2 Profil B — Opérateur / Inspecteur

Objectif :

- comprendre pourquoi une mutation a échoué,
- diagnostiquer un conflit ou un lock,
- inspecter la provenance d’une projection,
- vérifier la cohérence sync et curseurs.

Attentes produit :

- surfaces user-safe et admin-safe clairement séparées,
- accès ExplainReceipt,
- visibilité sur projectionRun (admin),
- absence totale de fuite sous mask.

---

## 2.3 Profil C — Administrateur Workspace

Objectif :

- gérer Workspaces,
- importer/exporter des snapshots,
- contrôler l’accès,
- superviser l’activité.

Attentes produit :

- import/export canonique (Package snapshot),
- audit fonctionnel et technique,
- métriques opérationnelles agrégées,
- séparation stricte des scopes (graphSpaceId).

---

# 3. Cas d’usage principaux supportés en v1

## 3.1 Exploration d’un Workspace

- Ouvrir un Workspace (graphSpaceId).
- Charger une ProjectionInstance par défaut ou via ViewPreset.
- Naviguer dans le graphe via Graph View + Panels.
- Inspecter tout élément via Inspector.

---

## 3.2 Création / édition via Overlay

- Ouvrir un Overlay (draft).
- Ajouter/modifier/supprimer des entités via DeltaSet.
- Visualiser immédiatement via OverlayGraphView.
- Commit explicite.
- Gérer échecs : CONFLICT, PRECONDITION, PERMISSION.

---

## 3.3 Mutation directe atomique

- Patch simple via Command directe.
- Attente stricte de TransactionReceipt.
- Mise à jour via Sync.

---

## 3.4 Diagnostic d’échec

- Visualiser category + reasonCode.
- En admin-safe : masked=true, lock diagnostics, resolveRevision.
- Comprendre divergence baseGraphRevision.

---

## 3.5 Import / Export snapshot

- Export d’un Workspace à un curseur admissible K.
- Import dans Workspace vide.
- Reconstruction déterministe.

---

## 3.6 Navigation multi-vues

- Changer de ProjectionInstance.
- Utiliser ViewPreset.
- Simulation via contextOverride (lecture seule).

---

# 4. Fonctionnalités incluses en v1

1. Graph View (projection déterministe).
2. Inspector (OIR, permissions, provenance).
3. Overlay workflow (draft → commit strict).
4. Pessimistic locking (entity-level graph, overlay-level overlay).
5. Feedback structuré reasonCode.
6. Undo append-only (overlay local + command compensatoire).
7. Sync poll + subscribe (best-effort).
8. Cursor filtré par principal.
9. Import/export snapshot.
10. Audit structuré (user-safe + admin-safe).
11. Projection invalidation & rebuild diagnostics (admin).
12. ViewPreset non révélateur.

### Déploiement et persistance (v1)

13. Distribution **Desktop** et **Web** (PWA possible).
14. Backend de persistance sélectionnable : **local** (navigateur), **remote** (ex. Supabase) et un mode **sync** conservé comme option technique, sous les contraintes v1 (pas de merge, pas de co-édition).

---

# 5. Fonctionnalités explicitement exclues

1. Merge concurrent automatique.
2. Rebase overlay automatique.
3. Co-édition fine simultanée d’un même overlay.
4. Offline optimistic commit.
5. Ordre total inter-stream.
6. Réécriture d’historique (pas de squash, pas d’edit d’events).
7. Snapshot canonique (toujours non autoritatif).
8. Cache cross-principal.
9. Synchronisation continue (live) bidirectionnelle Desktop ↔ Online **avec merge** ou multi-writer.
10. Promesse produit de collaboration multi-user en v1.


---

# 6. Contraintes et limites assumées

## 6.1 Mono-tenant, mono-user (v1)

- Un Workspace est opéré par un seul utilisateur en v1.
- Les primitives multi-user (sessions/locks/sync) restent présentes car elles font partie du modèle système, mais ne constituent pas une promesse de collaboration en v1.

## 6.2 Contrainte de verrouillage

- Toute mutation peut être rejetée pour lock.
- Aucune fusion automatique.

## 6.3 Contrainte de divergence

- Commit overlay échoue si baseGraphRevision divergente.

## 6.4 Contrainte sécurité

- Mask = indistinguable de NOT_FOUND.
- Transaction partiellement visible interdite.

## 6.5 Contrainte sync

- Subscribe best-effort.
- Poll source de vérité.

## 6.6 Contrainte UX

- Aucune action considérée effective avant receipt.

## 6.7 Déploiement Web/PWA sans serveur Mesh dédié

- En mode Web/PWA, le Kernel/Runtime est embarqué côté client.
- Aucune dépendance à un serveur applicatif Mesh une fois l’app chargée.

## 6.8 Remote storage (contrainte EventStore)

- Le mode remote doit garantir les propriétés nécessaires à un EventStore compatible (append-only, tx-closed, replay déterministe).
- Le produit v1 n’expose pas d’écriture canonique hors append d’événements/transactions et production de receipts.

## 6.9 Sync (single-writer)

- Le mode sync v1 est single-writer : un seul device/instance peut écrire.
- Le writer est choisi explicitement par l’utilisateur.

## 6.10 Offline PWA

- Offline = autorisé en Local (IndexedDB) uniquement.
- En ligne, l’utilisateur peut choisir Local / Remote / Sync, sans activer de merge ni de multi-writer.

---

# 7. Hypothèses produit structurantes

1. Le moteur sous-jacent est déjà déployé et conforme (Conformance Model v1).
2. Le produit v1 est mono-tenant, mono-user.
3. Les politiques allow | deny | mask sont configurées en amont.
4. Les projections sont définies hors-graph en v1.
5. Les overlays sont le mécanisme principal d’édition multi-étapes.
6. L’append-only est non négociable.
7. Le produit v1 existe en Desktop et en Web (PWA possible).
8. En Web/PWA, Kernel/Runtime sont embarqués côté client.
9. Remote = persistance distante se comportant comme un EventStore compatible (pas de CRUD canonique libre).
10. Sync v1 = réplication single-writer (writer choisi par l’utilisateur), sans merge.
11. Offline PWA = commit autorisé uniquement en Local (IndexedDB) ; en ligne, choix Local/Remote/Sync.

---

# 8. Risques produit majeurs

1. Friction UX liée à la stricteté receipt-only (attente de receipt, rollback si rejet).
2. Complexité perçue du modèle événementiel (cursors, tx-closed, invariants).
3. Risque d’écart d’implémentation sur remote/sync : une persistance distante qui ne respecte pas append-only/tx-closed/replay introduirait des divergences et invaliderait la conformité.
4. Mode sync mal compris (attendu comme multi-writer/merge) : nécessite un cadrage UX clair (single-writer).
5. Erreurs d’implémentation pouvant provoquer fuite sous mask.
6. Mauvaise gestion des curseurs entraînant états incohérents perçus.
7. Projection rebuild coûteux si mal optimisé.

---

# 9. Critères de succès v1

Mesh Explorer v1 est considéré réussi si :

1. Tous les tests Critical du Conformance Test Model v1 passent.
2. Aucune fuite sous mask n’est observée en audit sécurité.
3. Les overlays permettent un workflow clair et compréhensible.
4. Les conflits (lock / precondition) sont expliqués sans ambiguïté.
5. Les projections sont déterministes (rebuild == incremental).
6. Import/export reconstruit un état identique (normalisé).
7. L’utilisateur distingue toujours Draft vs Graph canonique.

---

# Conclusion

Mesh Explorer v1 transforme un système graph événementiel strict en produit opérable.

Il ne simplifie pas le moteur.
Il le rend utilisable.

Sans magie.
Sans merge implicite.
Sans altération des invariants.

Version v1 = cohérence avant confort.

---

## Source: product_architecture_feasibility_audit_v_1.md

# Product Architecture Feasibility Audit v1

Version: 1.0  
Status: Analytical Audit  
Scope: Alignement entre Product_v1_Definition.md et Architecture Mesh Explorer (4.x, 5.x, 6.x)

---

# 1. Tableau de Mapping — Feature Produit ↔ Couches Système

| Feature Produit v1 | Couches concernées | Support |
|--------------------|-------------------|---------|
| Exploration Workspace via projections | Projection Engine (4.x), View System (6.x), Sync (5.x) | Support natif |
| Overlay workflow (draft → commit strict) | Overlay System (4.x), Collaboration Model (5.x), Command API (4.x) | Support natif |
| Mutation directe atomique | Command API, Kernel, EventStore | Support natif |
| Pessimistic locking | Collaboration Model (5.x) | Support natif |
| Inspector (OIR, provenance, permissions) | Ontological Inspection Protocol, Security Hardening, Projection Engine | Support natif |
| Feedback structuré reasonCode | Command API, Permissions Model | Support natif |
| Undo append-only | Event Model (append-only), Interaction Contracts | Support natif |
| Sync poll + subscribe | Sync Layer (5.x) | Support natif (best-effort + poll truth) |
| Cursor filtré par principal | Security Hardening (mask), Sync Layer | Support natif |
| Import / Export snapshot | Import_Export_Interop v1, EventStore | Support natif (workspace vide requis) |
| Audit structuré (user-safe / admin-safe) | Observability & Auditability v1 | Support natif |
| Projection invalidation & rebuild diagnostics | Projection Engine v1 | Support natif |
| ViewPreset non révélateur | Application Layer v1 | Support natif |
| Distribution Desktop | Kernel + EventStore local | Support natif |
| Distribution Web/PWA (Kernel embarqué) | Runtime + EventStore local/remote | Support natif |
| Backend Local (IndexedDB) | EventStore impl locale | Support natif |
| Backend Remote (EventStore-compatible requis) | EventStore abstraction | Support partiel (contrainte forte) |
| Mode Sync single-writer | Sync Layer + Collaboration | Support partiel (usage restreint) |
| Offline PWA (Local uniquement) | EventStore local | Support natif |

---

# 2. Analyse des écarts

## 2.1 Adaptations mineures requises

### Remote EventStore-compatible
Le produit impose qu’un backend distant se comporte comme un EventStore append-only tx-closed.

Risque : implémentation distante (ex. BDD relationnelle naïve) ne garantissant pas strictement :
- tx-closed,
- ordre intra-stream,
- déterminisme replay.

Impact : adaptation d’implémentation, pas évolution architecturale.

Classification : Structural.

---

### Sync single-writer explicite
L’architecture supporte concurrence pessimiste.
Le produit contraint à un seul writer.

Cela nécessite :
- UX explicite de sélection writer,
- garde-fous empêchant multi-writer accidentel.

Pas d’évolution noyau.

Classification : Acceptable.

---

## 2.2 Évolutions architecturales potentielles (non bloquantes v1)

Aucune fonctionnalité produit v1 n’exige :
- merge concurrent,
- rebase automatique,
- ordre total inter-stream,
- modification append-only.

Donc aucune évolution architecture fondamentale requise.

---

## 2.3 Fonctionnalités incompatibles avec v1

Aucune dans le périmètre explicitement défini.

Les exclusions produit (multi-user réel, merge, optimistic offline) sont cohérentes avec l’architecture actuelle.

---

# 3. Points de friction majeurs

## 3.1 UX — Receipt-only strict

Impact :
- latence perceptible,
- rollback visuel en cas de rejet,
- nécessité de distinguer preview vs canon.

Risque UX élevé si mal implémenté.

Classification : Structural.

---

## 3.2 Remote backend mal conforme

Si remote ne respecte pas strictement EventStore invariants :
- divergence replay,
- perte tx-closed,
- corruption logique.

Classification : Critical (bloquant conformité).

---

## 3.3 Sync mal compris (attente multi-writer)

Produit v1 est single-writer.
Attente utilisateur potentiellement différente.

Classification : Acceptable (problème de cadrage produit, pas architectural).

---

## 3.4 Projection rebuild coûteux

Si datasets volumineux :
- performance impactée,
- latence ouverture Workspace.

Architecture supporte delta + snapshot.
Risque dépend implémentation.

Classification : Structural.

---

## 3.5 Sécurité — Mask non-fuyant

Tout écart dans :
- Sync filtering,
- Projection placeholder,
- Audit user-safe,

entraîne fuite.

Classification : Critical.

---

# 4. Zones à haut risque d’implémentation

1. Implémentation Remote EventStore-compatible.
2. Filtrage transactionnel strict sous mask.
3. Cursor filtré par principal (pas de trous observables).
4. Projection cache scoped par principal (pas cross-principal).
5. Commit overlay strict (baseGraphRevision resolue correctement).
6. Gestion idempotencyKey côté remote.

---

# 5. Classification synthétique des risques

## Critical (bloquant v1)

- Non-respect tx-closed (remote ou sync).
- Fuite sous mask (projection, sync, audit).
- Remote non append-only.
- Replay non déterministe.

## Structural (complexité forte)

- UX receipt-only.
- Performance projection rebuild.
- Cursor filtering correct.
- Overlay commit strict sans rebase.

## Acceptable (gérable)

- Friction pédagogique sur single-writer.
- Complexité conceptuelle du modèle événementiel.

---

# 6. Recommandation finale

## 6.1 MVP réaliste

Le produit v1 est livrable si :

1. Backend remote strictement EventStore-compatible.
2. Sync utilisé en single-writer strict.
3. Toutes surfaces user-safe validées via tests Security Critical.
4. Conformance Model v1 exécuté en intégralité.

Le MVP doit prioriser :
- Local backend + Desktop/Web local.
- Overlay workflow complet.
- Inspector robuste.
- Import/export validé.

Remote + Sync peuvent être activés après validation conformité stricte.

---

## 6.2 Ajustements recommandés

1. Spécifier explicitement un contrat technique minimal pour Remote EventStore.
2. Ajouter test automatique “remote replay determinism”.
3. Ajouter test “mask + sync + projection indistinguishable”.
4. UX explicite : badge single-writer actif.
5. Monitoring projection rebuild latency.

---

---

# 7. Remote EventStore Contract v1 (Normatif)

Status: Obligatoire pour tout backend "Remote" utilisé en v1.

Objectif: garantir qu’une persistance distante se comporte strictement comme un EventStore compatible avec les invariants 4.x, 5.x, 6.x.

---

## 7.1 Principes fondamentaux

Un Remote backend est conforme v1 uniquement s’il respecte les propriétés suivantes au niveau logique (indépendamment de la technologie sous-jacente):

1. Append-only logique strict.
2. Transactions atomiques visibles (tx-closed).
3. Ordre total par stream (`meta`, `graph`).
4. Déterminisme de replay.
5. Idempotence `(actor, idempotencyKey)`.
6. Absence de lecture partielle observable.

Aucun CRUD libre sur l’état canonique n’est autorisé.

---

## 7.2 Append-only logique

Le système DOIT garantir:

- Aucun UPDATE d’un événement commité.
- Aucun DELETE d’un événement commité.
- Toute modification canonique passe par l’ajout d’un nouvel événement.

La contrainte est logique: la base peut physiquement compacter, mais jamais altérer la sémantique append-only.

Violation = non conformité Critical.

---

## 7.3 Transactions atomiques (tx-closed)

Pour chaque `txId`:

- Tous les événements appartenant à une transaction DOIVENT être écrits dans une transaction DB unique.
- Aucune lecture ne DOIT exposer un sous-ensemble d’une transaction.
- La visibilité doit être "commit or nothing".

Si la base ne peut pas garantir isolation transactionnelle suffisante, elle est incompatible.

---

## 7.4 Ordre par stream

Le backend DOIT maintenir:

- Un compteur monotone `metaSeq` par stream `meta`.
- Un compteur monotone `graphSeq` par stream `graph`.

Contraintes:

- Séquence strictement croissante.
- Pas de réutilisation de seq.
- Index stable `(stream, seq)`.

L’ordre inter-stream global n’est pas requis.

---

## 7.5 Déterminisme de replay

Pour un EventStream donné et un LogicalSnapshot donné:

- La reconstruction MetaState et GraphState DOIT être déterministe.
- Snapshot + replay partiel DOIT produire le même état qu’un replay complet.

Les snapshots stockés côté remote DOIVENT inclure:

- eventCursor admissible exact.
- logicalSnapshotRef explicite.

---

## 7.6 Idempotence des Commands

Le backend DOIT garantir:

- Unicité logique `(actor, idempotencyKey)`.
- Rejeu strict retourne exactement le même résultat final (receipt ou erreur).

Implémentation minimale recommandée:

- Index unique sur `(actor, idempotencyKey)`.
- Stockage du résultat final associé.

---

## 7.7 Lecture par ranges (Sync compatible)

Les lectures par range DOIVENT:

- Respecter l’ordre par `seq`.
- Respecter tx-closed.
- Ne jamais produire de trou interne à une transaction.

Si un range coupe une transaction:

- Soit la réponse est ajustée à la frontière tx-closed.
- Soit la requête est refusée.

---

## 7.8 Contraintes de sécurité

Le Remote backend DOIT:

- Ne jamais exposer d’événements non filtrés en dehors du Kernel/Runtime.
- Permettre l’application du filtrage `allow | deny | mask` avant toute exposition.
- Ne pas exposer de curseur global révélateur.

---

## 7.9 Tests obligatoires (Conformance Critical)

Tout Remote backend DOIT passer au minimum:

1. Test append-only strict.
2. Test tx-closed strict (range + subscribe).
3. Test replay déterministe (full vs snapshot+replay).
4. Test idempotence stricte.
5. Test mask + sync indistinguishable.

Échec d’un seul test = backend non conforme v1.

---

## 7.10 Checklist d’implémentation rapide (Remote v1)

### A. Schéma minimal recommandé

- Table `events`:
  - eventId (PK, opaque)
  - txId (indexé)
  - stream (`meta` | `graph`)
  - seq (indexé par stream, unique)
  - payload (immutable)
  - createdAt

- Table `commands_idempotency`:
  - actor
  - idempotencyKey
  - receiptPayload
  - UNIQUE(actor, idempotencyKey)

---

### B. Invariants à vérifier au runtime

- Aucun UPDATE / DELETE sur `events` après commit.
- Toute écriture multi-events encapsulée dans une transaction DB.
- Attribution des `seq` strictement monotone par stream.
- Interdiction de lecture à un niveau d’isolation inférieur à READ COMMITTED (ou équivalent garantissant non-visibilité partielle).

---

### C. Snapshot (si implémenté)

- Snapshot stocke explicitement:
  - metaSeq
  - graphSeq
  - logicalSnapshotRef
- Snapshot jamais utilisé comme source de vérité sans replay.

---

### D. Sync compatibility

- Endpoint range respecte tx-closed.
- Pas d’event exposé hors frontière transactionnelle.
- CursorAfter correspond toujours à une frontière valide.

---

### E. Tests automatiques obligatoires en CI

- Rejeu complet vs snapshot+replay.
- Retry même idempotencyKey → même receipt exact.
- Tentative d’UPDATE event → rejet ou impossible.
- Range coupant tx → ajustement ou erreur.
- Mask scenario A (absent) vs B (masked) indistinguishable.


---

# 8. Cursor Filtré par Principal — Contract v1 (Normatif)

Status: Critical — concerne Sync, Security Hardening, Projection et UX.

Objectif: garantir qu’aucun principal ne puisse inférer l’existence d’entités ou de transactions masquées via la progression des curseurs.

---

## 8.1 Problème structurel

L’EventStore maintient un curseur global canonique:

    K_global = (metaSeq, graphSeq)

Sous masking, certaines transactions peuvent être invisibles pour un principal donné.

Si l’on expose directement `K_global`, on crée:

- des sauts inexpliqués,
- des trous observables,
- une fuite d’existence.

Donc le système DOIT exposer:

    K_principal = (metaSeq_visible, graphSeq_visible)

---

## 8.2 Définition normative

Un curseur visible est conforme v1 si:

1. Il est monotone (component-wise).
2. Il correspond toujours à une frontière tx-closed.
3. Il ne permet pas d’inférer une transaction masquée.
4. Il progresse uniquement lorsque des événements visibles sont délivrés.

Le curseur global ne DOIT jamais être exposé hors surfaces admin-safe autorisées.

---

## 8.3 Règle transaction masquée intégrale

Si une transaction contient au moins un événement touchant une entité masquée pour un principal:

→ La transaction complète est masquée.

Conséquence:

- Aucun événement de cette transaction ne contribue à `K_principal`.
- La progression de `K_principal` ignore totalement cette transaction.

---

## 8.4 Calcul du curseur visible

Algorithme logique:

1. Lire les événements depuis `K_principal`.
2. Filtrer par permissions.
3. Grouper par `txId`.
4. Éliminer toute transaction partiellement visible.
5. Appliquer uniquement les transactions entièrement visibles.
6. Avancer `K_principal` à la dernière frontière tx-closed visible.

Il est interdit d’avancer le curseur à un `seq` correspondant à une transaction masquée.

---

## 8.5 Propriétés obligatoires

### A. Pas de trous observables

Deux scénarios doivent être indistinguables côté user-safe:

- A: transaction absente
- B: transaction existante mais masquée

Observables comparés:

- forme des deltas
- progression du curseur
- absence de métadonnées révélatrices

---

### B. Cohérence avec Projection

ProjectionInstance DOIT:

- utiliser exclusivement `K_principal`
- ne jamais supposer la complétude de `K_global`

Un cache de projection est scoped par principal.

---

### C. Subscribe vs Poll

Subscribe est best-effort.
Poll est source de vérité.

En cas de divergence:

- le client DOIT refaire un poll depuis son dernier `K_principal` durablement appliqué.

---

## 8.6 Cas limites

### Transaction mixte (partiellement visible)

Interdit.

Soit:
- la transaction est totalement visible,
- soit totalement masquée.

Aucun préfixe autorisé.

---

### Multi-stream (meta + graph)

Ordre intra-transaction DOIT être respecté:

meta puis graph.

Le curseur visible DOIT rester tx-closed sur les deux composantes.

---

## 8.7 Tests Critical obligatoires

1. Scenario absent vs masked indistinguishable.
2. Transaction masquée ne fait pas progresser curseur visible.
3. Range request ne coupe jamais transaction visible.
4. Subscribe redelivery ne casse pas monotonicité.
5. Reprise après déconnexion conserve K_principal correct.

Échec = violation sécurité Critical.

---

---

# 9. Projection Cache Scoped par Principal — Contract v1 (Normatif)

Status: Critical — concerne Projection Engine, Runtime, Sync et Security Hardening.

Objectif: empêcher toute fuite cross-principal via caches de projection matérialisés.

---

## 9.1 Problème structurel

Les projections sont des caches matérialisés dérivés de:

    f(EventStream, LogicalSnapshot)

Sous masking, deux principaux différents peuvent avoir:

- un EventStream filtré différent,
- un K_principal différent,
- un ensemble d’entités visibles différent.

Si un ProjectionCache calculé sous Principal A est servi à Principal B:

→ fuite immédiate potentielle.

---

## 9.2 Règle normative fondamentale

Tout ProjectionCache DOIT être scoped au minimum par:

- graphSpaceId
- principal (ou politique de visibilité équivalente)
- projectionSpecId
- logicalSnapshotRef
- eventCursor (K_principal)

Il est interdit de partager un cache entre deux principaux ayant des politiques de visibilité différentes.

---

## 9.3 Clé de cache normative

Clé logique minimale recommandée:

    CacheKey = (
        graphSpaceId,
        principalVisibilityHash,
        projectionSpecId,
        logicalSnapshotRef,
        eventCursor
    )

`principalVisibilityHash` = représentation stable des permissions effectives.

Deux principaux distincts ne doivent jamais avoir la même clé si leurs permissions diffèrent.

---

## 9.4 Invalidation obligatoire

Un cache DOIT être invalidé si:

- changement de permissions effectives,
- changement de logicalSnapshotRef,
- changement de K_principal,
- invalidationReasons explicite.

Il est interdit de réutiliser un cache construit à un curseur global plus avancé que le curseur visible du principal.

---

## 9.5 Placeholder et Derived

Si une entité devient masquée pour un principal:

- le cache correspondant DOIT être reconstruit ou invalidé,
- aucun Derived ne doit conserver de dépendance révélatrice,
- Placeholder doit rester minimal et non révélateur.

---

## 9.6 Surfaces admin-safe

Un cache admin-safe peut:

- utiliser K_global,
- exposer txId / eventRefs,
- fournir diagnostics étendus.

Mais son accès DOIT être strictement contrôlé et journalisé.

---

## 9.7 Tests Critical obligatoires

1. Cache calculé sous principal A ne doit jamais être servi à principal B.
2. Changement de permission invalide cache.
3. Derived dépendant d’une entité masquée disparaît correctement.
4. Placeholder ne révèle aucun GraphID.
5. Rebuild complet vs delta reste déterministe sous principal donné.

Échec = fuite sécurité Critical.

---

---

# 10. Sync — Filtrage Transactionnel Strict sous Mask (Contract v1)

Status: Critical — concerne Sync Layer, Security Hardening, Cursor Filtering et Projection.

Objectif: garantir qu’aucune transaction partiellement visible ne puisse être délivrée via Poll ou Subscribe.

---

## 10.1 Problème structurel

Le Sync lit des événements par range à partir de l’EventStore.
Sous masking, certains événements d’une transaction peuvent être invisibles pour un principal.

Si le filtrage est appliqué événement par événement:

→ risque de livrer un sous-ensemble d’une transaction (violation tx-closed),
→ risque d’inférence par forme de delta,
→ corruption potentielle de Projection.

---

## 10.2 Principe normatif

Le filtrage DOIT être transactionnel, jamais événementiel.

Règle centrale:

    Filter ∘ GroupBy(txId) ∘ RangeRead

Et non:

    (Filter ∘ RangeRead) événement par événement

---

## 10.3 Algorithme normatif (Poll)

1. Lire un range brut depuis `K_principal` (ou depuis un curseur interne équivalent).
2. Grouper les événements par `txId`.
3. Pour chaque transaction:
   - Évaluer permissions sur toutes les cibles.
   - Si une seule cible est `mask` → marquer la transaction entière comme masquée.
4. Éliminer les transactions masquées.
5. Délivrer uniquement les transactions entièrement visibles.
6. Avancer `K_principal` uniquement sur les transactions délivrées.

Il est interdit:
- de délivrer un préfixe d’une transaction,
- d’avancer le curseur sur une transaction masquée.

---

## 10.4 Subscribe (best-effort)

Subscribe peut:
- recevoir des événements individuellement,
- subir redelivery (at-least-once).

Obligations supplémentaires:

- Maintenir un buffer par `txId`.
- Ne délivrer à la couche Projection qu’une transaction complète.
- En cas d’incertitude (transaction incomplète):
  - attendre la complétude,
  - ou déclencher un Poll correctif.

Subscribe ne peut jamais contourner la règle tx-closed.

---

## 10.5 Interaction avec Cursor Filtré

Le calcul de `K_principal` DOIT être couplé au filtrage transactionnel.

Il est interdit:
- d’avancer `K_principal` sur la base d’événements masqués,
- d’utiliser `K_global` comme référence visible.

Toute progression visible correspond strictement à une transaction visible.

---

## 10.6 Cas limites critiques

### A. Transaction volumineuse

Si un range coupe une transaction volumineuse:

- le Sync DOIT étendre la lecture jusqu’à la frontière tx-closed,
- ou refuser le range et ajuster.

### B. Transaction multi-entités avec permissions divergentes

Si une seule entité est `mask`:

→ transaction entièrement masquée.

Aucun “nettoyage partiel” autorisé.

### C. Changement de permissions entre lecture et livraison

Si permissions changent pendant le traitement:

- invalider le batch,
- recalculer via Poll.

---

## 10.7 Tests Critical obligatoires

1. Transaction contenant une entité masquée → aucune partie délivrée.
2. Range request coupant une transaction → jamais partielle.
3. Subscribe redelivery ne produit pas de double-application.
4. Cursor ne progresse jamais sur transaction masquée.
5. Projection rebuild après Sync reste déterministe.

Échec = violation sécurité Critical.

---

---

# 11. resolveRevision Non Révélateur — Contract v1 (Normatif)

Status: Critical — concerne Overlay commit, Security Hardening et Cursor Model.

Objectif: garantir que la résolution d’une révision (baseGraphRevision) ne permette aucune fuite entre:

- révision inexistante,
- révision existante mais masquée,
- révision existante mais non autorisée.

---

## 11.1 Problème structurel

Lors d’un commit d’overlay, le système appelle:

    resolveRevision(baseGraphRevision)

Si la révision n’est pas résoluble, plusieurs causes possibles:

1. Révision invalide (typo, corruption).
2. Révision appartenant à un autre graphSpaceId.
3. Révision existante mais hors visibilité (mask).
4. Révision obsolète (divergence réelle).

Si les réponses diffèrent visiblement selon la cause → fuite.

---

## 11.2 Principe normatif

En surface user-safe, les cas suivants DOIVENT être indistinguables:

- revision inconnue
- revision masquée
- revision non autorisée

La réponse DOIT être une erreur générique de type:

    PRECONDITION.CURSOR_MISMATCH

ou équivalent non révélateur.

Il est interdit de retourner:

- NOT_FOUND spécifique à revision,
- PERMISSION distincte révélant existence,
- diagnostics détaillés en user-safe.

---

## 11.3 Résolution interne (Kernel)

Le Kernel peut distinguer les cas pour usage interne:

- REVISION_NOT_FOUND
- REVISION_MASKED
- REVISION_SCOPE_MISMATCH

Mais cette distinction ne doit jamais franchir la surface user-safe.

---

## 11.4 Interaction avec Overlay Commit

Rappel règle v1:

- currentGraphSeq == graphSeqBase requis.
- Pas de rebase automatique.

Si resolveRevision échoue:

→ Commit rejeté.
→ UI propose rechargement ou recréation overlay.

Aucune tentative de correction implicite.

---

## 11.5 Cas limite — Admin-safe

En surface admin-safe autorisée:

- masked=true peut être exposé.
- diagnostics techniques peuvent être visibles.

Mais:

- accès strictement contrôlé.
- journalisation obligatoire.

---

## 11.6 Tests Critical obligatoires

1. Revision inexistante vs masquée indistinguable en user-safe.
2. Commit sur base divergente retourne même catégorie que base masquée.
3. Aucun message révélateur dans ExplainReceipt user-safe.
4. Admin-safe expose diagnostics uniquement si autorisé.

Échec = fuite sécurité Critical.

---

---

# 12. Overlay + Mask Edge Cases — Contract v1 (Normatif)

Status: Critical — concerne Overlay System, Permissions, Sync et Security Hardening.

Objectif: garantir qu’aucune fuite ne soit possible via:

- entityIdMap (tempId → realId),
- locks sur entités masquées,
- erreurs différenciées lors de commit overlay.

---

## 12.1 Problème structurel

Un overlay peut:

- créer des entités (tempId),
- référencer des entités existantes,
- modifier des entités.

Sous mask, certains targets peuvent être invisibles.

Si le système:
- retourne un mapping partiel,
- différencie une erreur "entité inexistante" vs "masquée",
- expose un lock révélateur,

→ fuite.

---

## 12.2 entityIdMap — règle d’exhaustivité contrôlée

Lors d’un commit overlay réussi:

- entityIdMap DOIT être exhaustif pour toutes les créations.
- entityIdMap NE DOIT contenir que des entités autorisées.

Il est interdit:
- de retourner un mapping partiel révélant qu’une création a été rejetée pour mask.

Si une cible référencée est masquée:

→ transaction entièrement rejetée (tx-closed).

---

## 12.3 Références vers entités masquées

Si un DeltaSet référence une entité masquée:

En user-safe:
- réponse indistinguable de NOT_FOUND.

En admin-safe (autorisé):
- masked=true peut être indiqué.

Il est interdit de différencier visuellement:
- entité inexistante,
- entité masquée,
- entité existante mais verrouillée et masquée.

---

## 12.4 Locks sur entités masquées

Si une entité est masquée mais verrouillée par ailleurs:

User-safe:
- message générique (ex: resource unavailable).
- aucune indication d’owner.

Il est interdit de révéler l’existence d’un lock sur une entité masquée.

---

## 12.5 TempId collision et inférence

Un attaquant pourrait tenter:

- créer un tempId,
- provoquer collision logique,
- observer différence de comportement.

Règle:

- tempId n’a aucune signification globale.
- seul le Kernel attribue realId.
- aucune collision externe observable.

---

## 12.6 Interaction avec Cursor et Sync

Si un commit overlay est rejeté pour mask:

- aucun événement ne doit apparaître en Sync.
- aucun progrès de K_principal ne doit être observé.

Overlay rejeté = aucune trace canonique visible.

---

## 12.7 Tests Critical obligatoires

1. entityIdMap toujours exhaustif en cas de succès.
2. Référence vers entité masquée → indistinguable NOT_FOUND.
3. Lock sur entité masquée ne révèle rien.
4. Aucun event visible après commit rejeté.
5. Aucun mapping partiel observable.

Échec = fuite sécurité Critical.

---

---

# 13. Matrice de Traçabilité — Risques Critical ↔ Contrats ↔ Tests ↔ Surfaces

Objectif: vérifier qu’aucun risque Critical identifié ne reste sans couverture contractuelle et sans test associé.

---

## 13.1 Remote non conforme (append-only / tx-closed / replay)

- Contrat: §7 Remote EventStore Contract
- Tests: 7.9 + 7.10.E
- Surfaces impactées:
  - Kernel
  - EventStore
  - Sync
  - Import/Export
- Sévérité: Critical (bloquant v1)

Couverture: Complète si CI inclut replay + tx-closed + idempotence.

---

## 13.2 Fuite sous mask (projection / sync / audit)

- Contrats:
  - §8 Cursor Filtré
  - §9 Projection Cache Scoped
  - §10 Sync Filtrage Transactionnel
  - §12 Overlay + Mask Edge Cases
- Tests:
  - 8.7
  - 9.7
  - 10.7
  - 12.7
- Surfaces impactées:
  - Sync Layer
  - Projection Engine
  - Inspector (USI)
  - ExplainReceipt

Couverture: Complète si tests indistinguishability exécutés systématiquement.

---

## 13.3 Cursor révélateur

- Contrat: §8 Cursor Filtré par Principal
- Tests: 8.7 (1–5)
- Surfaces impactées:
  - Sync Poll
  - Sync Subscribe
  - ProjectionInstance
  - UI “up-to-date” state

Couverture: Complète si aucun accès à K_global en user-safe.

---

## 13.4 Transaction partielle livrée

- Contrat: §10 Sync Transactionnel Strict
- Tests: 10.7
- Surfaces impactées:
  - Poll endpoint
  - Subscribe buffer
  - Projection delta apply

Couverture: Complète si groupement par txId obligatoire.

---

## 13.5 resolveRevision révélateur

- Contrat: §11 resolveRevision Non Révélateur
- Tests: 11.6
- Surfaces impactées:
  - Overlay commit
  - CommandError
  - ExplainReceipt

Couverture: Complète si user-safe unifie toutes causes en PRECONDITION générique.

---

## 13.6 Overlay entityIdMap révélateur

- Contrat: §12 Overlay + Mask Edge Cases
- Tests: 12.7
- Surfaces impactées:
  - Commit receipt
  - entityIdMap
  - Lock feedback
  - Sync post-commit

Couverture: Complète si mapping toujours exhaustif ou transaction rejetée intégralement.

---

# Conclusion

Après traçabilité complète:

- Chaque risque Critical identifié est couvert par:
  - un contrat normatif explicite,
  - une suite de tests obligatoires,
  - une liste de surfaces impactées.

Il ne reste pas de zone critique non formalisée.

Le produit v1 est structurellement cohérent avec l’architecture, sous condition d’implémentation conforme aux contrats §7 à §12.

Version v1 = cohérence démontrée + traçabilité complète.

Le produit v1 est **cohérent avec l’architecture existante**.

Aucune fonctionnalité définie ne viole les invariants 4.x, 5.x ou 6.x.

Les risques majeurs ne sont pas conceptuels mais d’implémentation stricte (EventStore distant, mask, cursors, overlay).

Sous réserve de conformité stricte, le produit v1 est **réellement livrable sans trahir l’architecture**.

Version v1 = cohérence respectée.

Le produit v1 est **cohérent avec l’architecture existante**.

Aucune fonctionnalité définie ne viole les invariants 4.x, 5.x ou 6.x.

Les risques majeurs ne sont pas conceptuels mais d’implémentation stricte (EventStore distant, mask, cursors).

Sous réserve de conformité stricte, le produit v1 est **réellement livrable sans trahir l’architecture**.

Version v1 = cohérence respectée.

---
## Source: mvp_scope_freeze_v_1.md

# MVP Scope Freeze v1

Version: 1.0  
Status: Scope Frozen  
Scope: Périmètre exécutable du MVP Mesh Explorer v1

Base: Product_v1_Definition.md + Product_Architecture_Feasibility_Audit_v1

---

# 1. Fonctionnalités incluses dans le MVP

## 1.1 Core Workspace

- Ouverture d’un Workspace (graphSpaceId unique actif).
- Navigation via ProjectionInstance.
- Graph View + Panels synchronisés.
- Inspector (OIR user-safe + admin-safe contrôlé).

## 1.2 Édition

- Overlay workflow complet (draft → commit strict).
- Mutation directe atomique via Command.
- Pessimistic locking.
- Undo append-only (overlay local + command compensatoire).

## 1.3 Sync

- Poll = source de vérité.
- Subscribe best-effort.
- Cursor filtré par principal.
- Filtrage transactionnel strict sous mask.

## 1.4 Sécurité

- allow | deny | mask non révélateur.
- Projection cache scoped par principal.
- resolveRevision non révélateur.
- entityIdMap sécurisé.

## 1.5 Import / Export

- Export snapshot à curseur admissible.
- Import dans Workspace vide.
- Reconstruction déterministe.

## 1.6 Déploiement

- Desktop (local EventStore).
- Web/PWA avec Kernel embarqué.
- Backend Local (IndexedDB).
- Backend Remote conforme Remote EventStore Contract v1.
- Mode Sync single-writer (writer explicitement choisi).

---

# 2. Fonctionnalités explicitement exclues

Même si présentes dans l’architecture, ne font pas partie du MVP:

- Multi-user collaboratif réel.
- Multi-writer Sync.
- Merge automatique.
- Rebase overlay automatique.
- Offline optimistic commit.
- Multi-workspace simultané sur une même surface.
- Ordre total inter-stream.
- Réécriture d’historique.
- Co-édition fine d’un overlay.
- Federation inter-workspaces.

---

# 3. Limites assumées du MVP

## 3.1 Techniques

- Single active Workspace.
- Sync single-writer uniquement.
- Remote strictement append-only.
- Performance projection dépend implémentation.

## 3.2 UX

- Receipt-only strict (latence possible).
- Conflits non fusionnés.
- Overlay rejeté sans rebase automatique.
- Conceptualité élevée (modèle événementiel exposé).

---

# 4. Hypothèses verrouillées

1. Conformance Model v1 validé.
2. Permissions configurées en amont.
3. Projections définies hors-graph.
4. Remote respecte strictement Remote EventStore Contract v1.
5. Sync utilisé uniquement en single-writer.
6. Aucune surface user-safe n’expose K_global.

---

# 5. Risques acceptés

- Friction UX liée au receipt-only.
- Complexité pédagogique du modèle.
- Performance rebuild projection si dataset volumineux.
- Mauvaise compréhension du single-writer.

Ces risques sont assumés et ne bloquent pas la livrabilité.

---

# 6. Définition d’un “MVP Coherent State”

Mesh Explorer v1 est considéré livrable si les conditions suivantes sont simultanément vraies:

1. Overlay workflow complet fonctionne sans fuite.
2. Poll + Subscribe maintiennent cohérence tx-closed.
3. Cursor filtré par principal sans trou observable.
4. Import/export reproduit état identique (normalisé).
5. Remote passe tous tests Critical (append-only, tx-closed, replay, idempotence).
6. Aucune fuite sous mask détectée en audit.
7. Projection rebuild == incremental.

Si une de ces conditions échoue → MVP non cohérent.

---

# 7. Clause de non-extension

Le périmètre défini ci-dessus est figé pour v1.

Aucune fonctionnalité supplémentaire ne peut être ajoutée sans:

- nouveau cycle produit formel,
- nouvel audit Product ↔ Architecture,
- nouvelle validation de conformité.

Le MVP v1 vise cohérence et sécurité avant extension fonctionnelle.

---

---

# 8. Clarifications Structurelles (Ambiguïtés Levées)

Suite à relecture croisée Product v1 + Audit + contrats techniques, les points suivants sont explicitement verrouillés afin d’éviter toute dérive implicite.

## 8.1 Remote et Sync ne sont pas requis pour la cohérence du MVP

Le "MVP Coherent State" ne dépend pas de l’activation du backend Remote ni du mode Sync.

Le cœur du MVP est considéré complet si :
- Backend Local fonctionne strictement (append-only, tx-closed).
- Overlay, Sync local, Projection et Security sont conformes.

Remote et Sync single-writer sont des modules activables après validation conformité.

Ils ne sont pas nécessaires pour déclarer v1 livrable.

---

## 8.2 Admin-safe limité au strict nécessaire

Le MVP inclut :
- Inspection admin-safe contrôlée (diagnostics minimalistes).

Le MVP n’inclut pas :
- Suite complète d’observabilité avancée.
- Dashboards techniques étendus.
- Monitoring distribué.

Admin-safe v1 est fonctionnel, pas industriel.

---

## 8.3 Mono-surface active

Le MVP garantit :
- Un seul Workspace actif par surface UI.
- Aucune multi-édition simultanée multi-workspace.
- Aucun partage d’état entre surfaces.

Multi-tab avancé ou orchestration multi-contextes exclus.

---

## 8.4 Projection et performance

Le MVP n’inclut pas :
- Optimisation avancée des projections volumineuses.
- Distribution de calcul.
- Cache partagé cross-principal.

La priorité est la cohérence, pas l’optimisation maximale.

---

## 8.5 Collaboration

Bien que l’architecture supporte locks pessimistes et Sync :

Le MVP :
- N’implémente aucune expérience collaborative multi-utilisateur.
- Ne promet aucun workflow temps réel partagé.

Les primitives existent, mais ne constituent pas une feature produit.

---

## 8.6 Web / PWA

En mode Web :
- Le Kernel/Runtime est embarqué côté client.
- Aucun serveur applicatif Mesh dédié requis.

Le MVP ne comprend pas :
- API server Mesh.
- Backend métier intermédiaire.

---

## 8.7 Gel strict du périmètre

Toute tentative d’ajouter :
- merge automatique,
- co-édition,
- multi-writer,
- offline optimiste,
- optimisation majeure non prévue,

constitue un changement de version produit.

---

# Décision

Le MVP Mesh Explorer v1 est strictement limité au périmètre défini dans ce document.

Ambition maîtrisée.
Périmètre discipliné.
Exécution prioritaire sur cohérence.

Le MVP Mesh Explorer v1 est strictement limité au périmètre défini dans ce document.

Ambition maîtrisée.
Périmètre discipliné.
Exécution prioritaire sur cohérence.

---
## Source: implementation_phasing_plan_v_1.md

# Implementation Phasing Plan v1

Version: 1.0  
Status: Execution Order Defined  
Scope: Ordre minimal et discipliné d’implémentation du MVP Mesh Explorer v1

Base: MVP_Scope_Freeze_v1.md

---

# Séquence d’Implémentation Minimale (Ordre Exécutable)

Objectif : définir l’ordre strict de construction pour éviter toute dérive fonctionnelle ou technique.

---

## Phase 1 — Noyau Local Cohérent (indispensable)

1. EventStore Local append-only strict.
2. Kernel + Command API + idempotence.
3. Sync Poll local tx-closed.
4. Projection Engine déterministe.
5. Cursor filtré par principal (même si mono-user).
6. Overlay workflow complet (draft → commit strict).
7. Filtrage transactionnel strict sous mask.
8. Tests Critical (local uniquement).

### Condition de sortie Phase 1

- Overlay fonctionne.
- Projection rebuild == incremental.
- Aucun event partiel visible.

---

## Phase 2 — UX Stabilisée

9. Graph View + Panels attachés à ProjectionInstance.
10. Inspector (OIR user-safe).
11. Feedback reasonCode structuré.
12. Undo append-only.
13. Placeholder non révélateur.

### Condition de sortie Phase 2

- Workflow édition complet utilisable.
- Aucune fuite sous mask.

---

## Phase 3 — Import / Export

14. Export snapshot à curseur admissible.
15. Import dans Workspace vide.
16. Test replay déterministe importé.

### Condition de sortie Phase 3

- État exporté == état importé (normalisé).

---

## Phase 4 — Remote (si activé)

17. Implémentation Remote EventStore conforme §7.
18. Tests append-only + tx-closed + replay.
19. Idempotence persistée.
20. Cursor filtré compatible remote.

### Condition de sortie Phase 4

- Tous tests Critical passent en remote.

---

## Phase 5 — Sync single-writer (si activé)

21. Sélection explicite writer.
22. Subscribe best-effort + buffer tx.
23. Tests multi-device single-writer.

### Condition de sortie Phase 5

- Aucun multi-writer possible.
- Cohérence tx-closed maintenue.

---

# Principe Directeur

- Une phase ne commence pas si la précédente n’a pas atteint son état cohérent.
- Le MVP est déclarable livrable dès la fin de la Phase 3.
- Les Phases 4 et 5 sont des extensions contrôlées, non nécessaires au cœur cohérent v1.

---

# Décision

L’ordre d’implémentation est figé tel que défini ci-dessus.

Aucune inversion de phase sans justification architecturale formelle.

---
## Source: mvp_acceptance_criteria_v_1.md

# MVP Acceptance Criteria v1

# MVP_Acceptance_Criteria_v1

Version: 1.0  
Status: Acceptance Criteria Frozen  
Scope: Critères d’acceptation vérifiables pour MVP Mesh Explorer v1

Base: MVP_Scope_Freeze_v1.md + Contracts §7–§12

---

# 1. Fonctionnalités MVP couvertes

F1. EventStore Local append-only + Kernel
F2. Sync Poll tx-closed (local)
F3. Cursor filtré par principal
F4. Projection Engine déterministe
F5. Overlay workflow (draft → commit strict)
F6. Mutation directe atomique
F7. Inspector (OIR user-safe + admin-safe contrôlé)
F8. Filtrage transactionnel strict sous mask
F9. Projection cache scoped par principal
F10. resolveRevision non révélateur
F11. entityIdMap sécurisé
F12. Import / Export snapshot déterministe
F13. Undo append-only

---

# 2. Critères détaillés par fonctionnalité

Note méthodologique :

- "UI test" = comportement observable sans accès interne.
- "Replay test (B)" = reconstruction état via replay complet.
- "Receipt/Error test (A)" = validation structure réponse Command.
- "Projection test (C)" = cohérence ViewModel.
- "Security test (D)" = indistinguishability / non-fuite.

Aucun critère ne repose sur une interprétation implicite.

---

---

## F1 — EventStore Local append-only + Kernel

### Description
Moteur local garantissant append-only, tx-closed, idempotence.

### Cas nominal
- Command valide → TransactionReceipt.
- Events écrits une seule fois.

### Cas limite
- Retry même idempotencyKey.

### Cas d’erreur
- Validation error.
- PRECONDITION.

### Critères d’acceptation
- **AC-F1-01** — Aucun UPDATE/DELETE sur événement commité possible.
- **AC-F1-02** — Rejeu complet = état identique (test B).
- **AC-F1-03** — Retry idempotent retourne receipt identique (test A).
- **AC-F1-04** — Aucune transaction partielle observable (test D).

### Invariants
I-02, I-04, I-06, I-10
INV-SH-1

### Validation
Replay test + Security test

---

## F2 — Sync Poll tx-closed

### Description
Lecture par range respectant frontières transactionnelles.

### Cas nominal
- Poll depuis K → transactions complètes délivrées.

### Cas limite
- Range coupe transaction volumineuse.

### Cas d’erreur
- Cursor invalide.

### Critères d’acceptation
- **AC-F2-01** — Jamais de transaction partielle délivrée.
- **AC-F2-02** — CursorAfter toujours frontière tx-closed.
- **AC-F2-03** — Projection rebuild == incremental.
- **AC-F2-04** — Si un range coupe une transaction, le Sync étend la lecture jusqu’à la frontière tx-closed ou refuse la requête; aucune troncature silencieuse n’est autorisée.

### Invariants
I-04, I-06
INV-SH-1

### Validation
Sync test + Replay test

---

## F3 — Cursor filtré par principal

### Description
Exposition de K_principal non révélateur.

### Cas nominal
- Transaction visible → progression monotone.

### Cas limite
- Transaction masquée.

### Cas d’erreur
- Tentative accès K_global en user-safe.

### Critères d’acceptation
- **AC-F3-01** — Transaction masquée ne fait pas progresser le curseur visible.
- **AC-F3-02** — Absent vs masked indistinguishable (test D).
- **AC-F3-03** — Monotonicité stricte maintenue (component-wise).

### Invariants
I-11
SH-CURSOR-1

### Validation
Security test D

---

## F4 — Projection Engine déterministe

### Description
Projection = f(EventStream, LogicalSnapshot)

### Cas nominal
- Delta application cohérente.

### Cas limite
- Rebuild complet.

### Cas d’erreur
- Snapshot incohérent.

### Critères d’acceptation
- **AC-F4-01** — Rebuild complet == état incremental (B/C).
- **AC-F4-02** — Derived exposent provenance correcte en user-safe sans fuite (C/D).
- **AC-F4-03** — Placeholder non révélateur (aucun GraphID exposé) (C/D).
- **AC-F4-04** — Si la provenance d’un Derived dépend d’une entité masquée, la provenance est absente ou générique en user-safe (aucune dépendance indirecte révélée) (C/D).

### Invariants
I-01, I-06, I-11

### Validation
Replay test + UI test

---

## F5 — Overlay workflow

### Description
Draft → Commit strict sans rebase.

### Cas nominal
- Commit réussi → entityIdMap exhaustif.

### Cas limite
- Divergence baseGraphRevision.

### Cas d’erreur
- Lock actif.
- Mask cible.

### Critères d’acceptation
- **AC-F5-01** — Commit multi-entités atomique (tout ou rien).
- **AC-F5-02** — Divergence baseGraphRevision → rejet PRECONDITION (non rebase).
- **AC-F5-03** — Commit rejeté → aucune trace canonique visible (pas d’events livrés, pas de progression K_principal).
- **AC-F5-04** — En user-safe, les erreurs liées à resolveRevision (révision inconnue/masquée/non autorisée) déclenchent exactement le même feedback UX (même catégorie, même wording, mêmes affordances).

### Invariants
I-04, I-09, I-10, I-15
INV-SH-1

### Validation
UI test + Security test

---

## F6 — Mutation directe atomique

### Description
Command atomique sans overlay.

### Cas nominal
- Patch simple validé.

### Cas limite
- Retry avec même idempotencyKey.

### Cas d’erreur
- VALIDATION
- PERMISSION (deny | mask)
- CONFLICT

### Critères d’acceptation
- **AC-F6-01** — Aucun changement visible avant TransactionReceipt.
- **AC-F6-02** — CommandError → état strictement identique à l’état pré-Command (replay B).
- **AC-F6-03** — Retry même idempotencyKey → même receipt/erreur finale (A).
- **AC-F6-04** — PERMISSION.mask indistinguable de NOT_FOUND (D).
- **AC-F6-05** — En cas de timeout transport puis retry avec même idempotencyKey, aucun double-apply n’est possible et l’état final est identique à un unique apply (A/B).

### Invariants
I-06, I-10, I-11

### Validation
UI + Receipt test + Replay test + Security test


---

## F7 — Inspector

### Description
Surface d’inspection ontologique non révélatrice.

### Cas nominal
- Sélection entité Real.

### Cas limite
- Sélection Derived.
- Sélection Placeholder.

### Cas d’erreur
- Entité masquée.

### Critères d’acceptation
- **AC-F7-01** — OntologicalStatus toujours affiché.
- **AC-F7-02** — Derived affiche provenance user-safe sans exposer EntityRef masquée (D).
- **AC-F7-03** — Placeholder n’expose jamais GraphID.
- **AC-F7-04** — Entité masquée indistinguable d’inexistante en user-safe (D).
- **AC-F7-05** — La section Provenance n’expose aucune structure (cardinalités, dépendances) permettant d’inférer une entité masquée; si risque, la section est absente ou générique (C/D).

### Invariants
I-01, I-11

### Validation
UI test + Security test


---

## F8 — Filtrage transactionnel strict

### Description
Sync applique le filtrage au niveau transaction (`txId`) et garantit tx-closed sous `mask`.

### Cas nominal
- Poll délivre uniquement des transactions entièrement visibles.

### Cas limite
- Range coupe une transaction volumineuse.
- Transaction multi-entités avec une cible masquée.

### Cas d’erreur
- Subscribe reçoit événements incomplets (redelivery / out-of-order). 

### Critères d’acceptation
- **AC-F8-01** — Filtrage appliqué par transaction (groupBy txId), jamais événement par événement.
- **AC-F8-02** — Si une transaction touche une entité masquée → transaction entière masquée (aucun event délivré).
- **AC-F8-03** — Poll/Subscribe ne délivrent jamais une transaction partielle (tx-closed observable).
- **AC-F8-04** — CursorAfter n’avance que sur transactions délivrées et reste admissible.

### Invariants
I-04, I-11
INV-SH-1
SH-MASK-TX-1

### Validation
Sync test + Security test D

---

## F9 — Projection cache scoped

### Description
Les caches de projection sont scoped par principal (ou hash de visibilité) et ne sont jamais partagés cross-principal.

### Cas nominal
- Cache réutilisé uniquement pour même principalVisibilityHash.

### Cas limite
- Changement de permissions effectives.

### Cas d’erreur
- Tentative de servir un cache issu d’un autre principal.

### Critères d’acceptation
- **AC-F9-01** — CacheKey inclut principalVisibilityHash (ou équivalent) + graphSpaceId + projectionSpecId + logicalSnapshotRef + K_principal.
- **AC-F9-02** — Un cache calculé sous principal A n’est jamais servi à principal B (D).
- **AC-F9-03** — Changement de permissions effectives invalide/reconstruit le cache.
- **AC-F9-04** — Placeholder/Derived restent non révélateurs après invalidation (C/D).
- **AC-F9-05** — Un changement de permissions effectives en cours de session invalide immédiatement les caches concernés et force une reconstruction cohérente sous le nouveau principalVisibilityHash (C/D).

### Invariants
I-11
SH-RUNTIME-1

### Validation
Security test D + Projection test C

---

## F10 — resolveRevision non révélateur

### Description
La résolution d’une baseGraphRevision ne doit pas révéler si la révision est inexistante, masquée ou non autorisée.

### Cas nominal
- baseGraphRevision résolue → overlay commit continue.

### Cas limite
- Révision obsolète (divergence réelle).

### Cas d’erreur
- Revision inconnue / masquée / non autorisée.

### Critères d’acceptation
- **AC-F10-01** — En user-safe, revision inconnue vs masquée vs non autorisée sont indistinguables (D).
- **AC-F10-02** — Erreur user-safe unifiée de type PRECONDITION.CURSOR_MISMATCH (ou équivalent non révélateur).
- **AC-F10-03** — Diagnostics différenciés possibles uniquement en admin-safe contrôlé.
- **AC-F10-04** — Les différences de cause (inconnue/masquée/non autorisée) ne modifient ni le code d’erreur user-safe, ni la structure de réponse observable (A/D).

### Invariants
I-11, I-15
SH-REV-1

### Validation
Security test D

---

## F11 — entityIdMap sécurisé

### Description
Le mapping tempId → realId ne doit jamais fuir d’information sous mask et doit être exhaustif en cas de succès.

### Cas nominal
- Créations via overlay → commit réussi → entityIdMap complet.

### Cas limite
- Plusieurs créations + relations internes.

### Cas d’erreur
- DeltaSet référence une entité masquée.

### Critères d’acceptation
- **AC-F11-01** — Succès: entityIdMap exhaustif pour toutes les créations (tempId créés dans l’overlay).
- **AC-F11-02** — Échec: aucun mapping partiel observable (transaction rejetée intégralement, pas d’events visibles).
- **AC-F11-03** — Référence vers entité masquée → réponse user-safe indistinguable de NOT_FOUND (D).

### Invariants
I-04, I-11
SH-OVL-3

### Validation
Security test D + Receipt test A

---

## F12 — Import / Export

### Description
Export snapshot à curseur admissible puis import dans workspace vide.

### Cas nominal
- Export K admissible.
- Import dans workspace vide.

### Cas limite
- Export après transactions multiples.

### Cas d’erreur
- Import workspace non vide → rejet.

### Règle normative — Agrégats exportables en user-safe

En export user-safe, seuls les agrégats suivants sont autorisés :

1. Agrégats calculés exclusivement à partir d’entités visibles pour le principal (après filtrage mask).
2. Agrégats globaux ne référant aucune entité individuelle (aucun EntityRef, aucun identifiant stable).
3. Agrégats respectant un seuil minimal anti-isolation (v1) :
   - toute cellule agrégée DOIT représenter au moins 2 entités visibles (k ≥ 2 en v1),
   - sinon l’agrégat est supprimé ou remplacé par une valeur générique.

Il est interdit :
- d’exporter des compteurs par identifiant canonique,
- d’exporter des structures permettant de reconstruire indirectement des entités masquées,
- d’exporter des agrégats calculés sur l’état global non filtré.

### Critères d’acceptation
- **AC-F12-01** — Snapshot inclut curseur admissible exact.
- **AC-F12-02** — Import dans workspace vide uniquement (sinon rejet normatif).
- **AC-F12-03** — État final après import == état source normalisé (B).
- **AC-F12-04** — Export user-safe ne révèle pas EntityRef masquée (D).
- **AC-F12-05** — L’export user-safe ne révèle pas indirectement des cardinalités, index ou structures permettant d’inférer l’existence d’entités masquées (D).
- **AC-F12-06** — Tout agrégat exporté en user-safe est calculé post-filtrage mask et respecte le seuil minimal anti-isolation k ≥ 2 (D).
- **AC-F12-07** — Si un agrégat ne respecte pas le seuil minimal, il est supprimé ou remplacé par une valeur générique non révélatrice (D).

### Invariants
I-06, I-11

### Validation
Replay test + Security test


---

## F13 — Undo append-only

### Description
Undo respecte append-only: aucune réécriture d’historique. Deux niveaux: overlay (local) et graph (compensatoire).

### Cas nominal
- Undo overlay: modifie uniquement DeltaSet.
- Undo graph: émet une Command compensatoire.

### Cas limite
- Undo d’une mutation multi-entités.

### Cas d’erreur
- Undo compensatoire rejeté (lock / permission / precondition).

### Critères d’acceptation
- **AC-F13-01** — Undo overlay n’écrit aucun événement canonique.
- **AC-F13-02** — Undo graph = nouvelle Command (append-only), aucun événement existant supprimé/modifié.
- **AC-F13-03** — Undo compensatoire suit receipt-only (pas d’effet réputé réel avant receipt).
- **AC-F13-04** — En cas de retry après timeout d’un undo compensatoire, aucun double-apply n’est possible; l’historique reste append-only cohérent (A/B).

### Invariants
I-02, I-10

### Validation
UI test + Replay test B + Receipt test A

---

# 3. Definition of Done (Feature)

Une fonctionnalité est considérée terminée si:

1. Tous critères d’acceptation sont validés.
2. Tous tests associés passent (A/B/C/D + INV-SH).
3. Aucun invariant impacté n’est violé.
4. Aucun comportement implicite non documenté.
5. Cas d’erreur validés.

---

# 4. Conditions globales MVP v1 validé

Le MVP est validé uniquement si:

1. Toutes fonctionnalités F1–F13 respectent leur Definition of Done.
2. Tous tests Critical (Remote exclus si non activé) passent.
3. Aucun test Security D ne révèle différence entre absent et masked.
4. Projection rebuild complet == incremental sur au moins trois scénarios distincts (simple, multi-tx, overlay).
5. Aucun scénario de transaction partielle détecté en audit.
6. Aucun accès K_global en surface user-safe.
7. Export → Import → Replay produit état identique (normalisé).

Si un seul point échoue → MVP non validé.

Sans validation formelle de ces points, le MVP ne peut être déclaré terminé.

---

# Décision

Le MVP v1 est mesurable et vérifiable uniquement via les critères définis ci-dessus.

Aucune déclaration de "terminé" sans preuve testable.

---

# Global Conclusion — Strategic State v1

Le bloc stratégique produit v1 est désormais consolidé.

✔ MVP verrouillé  
✔ Faisabilité architecture validée  
✔ Périmètre figé  
✔ Plan d’implémentation séquencé  
✔ Critères d’acceptation mesurables définis

Aucune extension implicite.
Aucune modification des invariants.
Aucune ambiguïté structurelle restante.

Le passage en phase d’exécution est autorisé.

---

Version consolidée prête pour implémentation.


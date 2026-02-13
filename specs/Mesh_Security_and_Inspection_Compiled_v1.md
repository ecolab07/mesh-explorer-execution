# Mesh Security and Inspection Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: permissions_model.md

# Mesh Explorer --- Permissions (RBAC + ABAC léger)

## Actions

-   read
-   traverse
-   create
-   update
-   delete
-   commit
-   admin

## Autorisation

Authorize(subject, action, target, scope) -\> allow \| deny \| mask

-   mask = n'existe pas pour le sujet
-   deny = visible mais action interdite

## Reason Codes

Format: DENY.`<ACTION>`{=html}.`<TARGET>`{=html}.`<DETAIL>`{=html}

Exemples: - DENY.UPDATE.FIELD.salary -
DENY.TRAVERSE.REL.investigation_link - DENY.COMMIT.OVERLAY.not_draft

------------------------------------------------------------------------

## Source: ontological_inspection_protocol.md

# Mesh Explorer --- Protocole d'Inspection Ontologique

## OntologicalStatus

-   Real
-   Derived
-   Overlay
-   Placeholder (cliquable minimal)

## OIR (Ontological Inspection Record)

OIR { ontologicalStatus identity typeInfo scopeInfo origin provenance?
overlayContext? permissions }

## Placeholder

-   Aucun GraphID exposé
-   Hint générique
-   Inspection minimaliste

## Trace (coarse)

Trace { projectionId paramsHash steps }

## Invariants

1.  Statut ontologique toujours inspectable
2.  Overlay ≠ Truth
3.  Placeholder sans fuite d'information
4.  Permissions vérifiées côté moteur

------------------------------------------------------------------------

## Source: Security_Hardening_v1.md

# Mesh Explorer --- Renforcement de la sécurité

Version: 1.1  
Status: Normatif  
Scope: Durcissement sécurité transversal — Mesh Explorer v1

Compatible avec : Event Model v1, Command / Intent API v1, EventStore & Persistence v1, Graph Runtime v1, Projection Engine v1, Sync Layer v1, Permissions model, Overlay System v1.5, Identity & Addressing v1.

---

# 1. Objectifs formels du hardening sécurité

## SH-OBJ-1 — Préservation des invariants systémiques
Le hardening sécurité DOIT garantir que les invariants suivants ne puissent pas être violés par erreur d’implémentation :

- tx-closed strict
- ordre sémantique meta → graph intra-transaction
- séparation ontologique (vue ≠ vérité)
- non-fuite sous mask
- déterminisme à curseur admissible

## SH-OBJ-2 — Sécurité transversale uniforme
Les décisions de sécurité (allow | deny | mask) DOIVENT être appliquées de manière cohérente sur :

- commit path (Kernel)
- read path (Runtime, Projection)
- sync / transport
- export
- observabilité / audit
- caches et snapshots

## SH-OBJ-3 — Absence de canaux latéraux
Aucune surface ne DOIT permettre d’inférer :

- l’existence d’une entité masquée
- l’existence d’une transaction partielle
- l’existence d’un overlay non autorisé
- la divergence meta/graph intra-transaction

## SH-OBJ-4 — Séparation stricte des plans
Aucun mécanisme ne DOIT permettre une contamination du plan graph par des artefacts overlay / derived / projection.

---

# 2. Modèle de menaces minimal (v1)

Ce modèle cible exclusivement les risques réalistes d’implémentation.

## 2.1 Surfaces critiques

### S-1 — Projections
Risque : fuite via Derived, Placeholder mal implémenté, violations non filtrées.

### S-2 — Export (Package)
Risque : export d’entités masquées ou d’informations indirectes (structure, cardinalités, agrégats).

### S-3 — Sync / Transport
Risque : fuite par trous de séquence, transaction partiellement filtrée, timing différentiel.

### S-4 — Logs / Observabilité
Risque : log d’IDs masqués, dump d’EntityRef non filtré.

### S-5 — Caches / Snapshots
Risque : persistance de données non filtrées dans cache partagé.

### S-6 — Overlay
Risque : mapping tempId → realId révélant des cibles non autorisées.

---

# 3. Politique normative globale : DENY-WINS

## 3.1 Principe

En cas de conflit :

    allow vs deny → deny
    allow vs mask → mask
    deny vs mask → mask

Le moindre privilège gagne toujours.

## 3.2 Portée

Cette règle DOIT être appliquée sur :

- PermissionCheck au commit
- Filtrage des Events en Sync
- Projection filtering
- Export
- Inspection (OIR)
- Observabilité

Aucune couche ne peut réouvrir un accès fermé en amont.

---

# 4. Spécification normative du masking / redaction

## 4.1 Définition

mask = l’entité est traitée comme inexistante pour le sujet.

Conséquences obligatoires :

1. Aucun GraphID ne DOIT être exposé.
2. Aucun EventEnvelope révélant la cible ne DOIT être transmis.
3. Les erreurs DOIVENT être indistinguables d’un NOT_FOUND.
4. Les locks ne DOIVENT pas révéler l’existence.
5. Les Derived dépendants DOIVENT être masqués intégralement.

---

## 4.2 Filtrage transactionnel strict

### Règle SH-MASK-TX-1

Si une transaction contient au moins un événement touchant une entité masquée pour un principal donné :

> La transaction complète DOIT être masquée.

Il est interdit de transmettre une transaction partiellement filtrée.

---

## 4.3 Curseurs filtrés par principal

### Règle SH-CURSOR-1

Le curseur global canonique `(metaSeq, graphSeq)` est interne.

Le curseur exposé à un principal DOIT être :

    K_principal = (metaSeq_visible, graphSeq_visible)

avec :

- monotonicité stricte
- respect tx-closed
- absence de trous observables

Il est interdit d’exposer le graphSeq global si cela introduit des discontinuités dues au masking.

---

## 4.4 Application du masking par couche

### 4.4.1 Kernel

Authorize = mask ⇒

- la réponse **user-safe** DOIT être indistinguable d’un NOT_FOUND (conforme `mask`).
- la réponse **admin-safe** (surfaces d’inspection/audit contrôlées) MAY exposer : `category=PERMISSION`, `reasonCode`, et `masked=true`.

Règle : les reason codes restent **normatifs et stables**, mais leur exposition est gouvernée par `allow | deny | mask`.

### 4.4.2 Runtime

Le Runtime interne peut observer l’état complet.

Toute exposition externe DOIT passer par un filtrage conforme aux règles SH-MASK-*.

### SH-RUNTIME-1 — Caches et snapshots

- Tout cache/snapshot partagé entre plusieurs principaux NE DOIT PAS contenir de vues filtrées ambiguës.
- Toute matérialisation filtrée (projection cache, export cache, réponse sync) DOIT être scoped par principal (ou par politique de visibilité équivalente).
- Il est interdit de servir un cache construit sous un principal différent.

# 4.4.3 Projection Engine

- Toute entité masquée DOIT devenir Placeholder minimal.
- Toute Derived dépendant d’une entité masquée DOIT être masquée intégralement.

### 4.4.4 Sync Layer

Le filtrage DOIT être appliqué avant émission.

Aucun trou de seq ne DOIT être observable.

### 4.4.5 Export

Voir section 6.

### 4.4.6 Observabilité

L’observabilité et l’audit DOIVENT respecter `allow | deny | mask`.

- Toute surface d’observabilité exposée à un non-admin DOIT être **user-safe** (non-fuyante), y compris sur l’existence d’un enregistrement.
- Les surfaces techniques (admin) MAY contenir plus de détails, mais DOIVENT journaliser et contrôler l’accès.

Règles minimales :

- Les logs/audits exposés **MUST NOT** contenir d’EntityRef révélatrices si `masked=true`.
- Les métriques et agrégats DOIVENT éviter les segmentations qui réintroduisent une fuite (ex. compteurs “par cible” visibles).
- Toute corrélation (correlationId/commandId/txId) exposée à un sujet DOIT rester non-fuyante.

---

# 5. Règles tx-closed strict (anti-fuite)

## SH-TX-1 — Aucun event partiel

Aucun consumer ne DOIT observer :

- un metaEvent sans ses graphEvents associés
- un graphEvent dont les metaEvents de la transaction ne sont pas visibles

## SH-TX-2 — Transaction masquée intégrale

Voir SH-MASK-TX-1.

## SH-TX-3 — Cursor admissible uniquement

Tout cursorAfter exposé DOIT :

- correspondre à une frontière de transaction
- ne jamais pointer au milieu d’un txId

---

# 6. Export sécurisé

## SH-EXPORT-1 — Reconstruction sous visibilité

Un export DOIT être reconstruit sous le modèle suivant :

    Projection = f(EventStream_filtré, LogicalSnapshot)

Il est interdit de :

- reconstruire l’état global
- puis supprimer les entités masquées en post-traitement

L’état exporté DOIT être structurellement cohérent sous les permissions du principal.

## SH-EXPORT-2 — Dépendances masquées

Si le masking rend l’état incohérent (ex: relation vers cible masquée), l’export DOIT appliquer une stratégie unique et stable :

- soit supprimer toutes les relations dont au moins une extrémité est masquée (sans exposer la raison)
- soit refuser l’export (erreur non révélatrice)

La stratégie choisie DOIT être uniforme et non dépendre du contenu masqué.

---

# 7. Violations et masking

## SH-VIOL-1 — Violations ciblées

Toute violation associée à une entité masquée DOIT être masquée intégralement.

## SH-VIOL-2 — Violations globales (L3)

Les violations globales peuvent être exposées sous forme agrégée sans EntityRef.

Il est interdit de révéler des identifiants indirectement via violation.

---

# 8. Overlay et sécurité

## SH-OVL-1 — Overlay : deltas non révélateurs

Un utilisateur MAY créer/éditer un overlay (artefact non ontologique).

Toute Command qui tente d’ajouter un delta ciblant une entité masquée DOIT être traitée selon `mask` :

- user-safe : indistinguable NOT_FOUND
- admin-safe : `masked=true` + reasonCode

Il est interdit qu’un overlay ou son feedback UI permette d’inférer l’existence d’une entité masquée via :
- erreurs différenciées
- hints de locks
- mapping partiel

## SH-OVL-2 — Commit strict

Commit overlay DOIT échouer si divergence baseGraphRevision.

## SH-OVL-3 — Mapping sécurisé

entityIdMap DOIT :

- être exhaustif pour les créations
- ne contenir que des entités autorisées

---

# 9. resolveRevision non révélateur

## SH-REV-1

resolveRevision(baseGraphRevision) DOIT être non révélateur.

Les erreurs :

- revision inconnue
- revision non autorisée

DOIVENT être indistinguables extérieurement.

---

# 10. Invariants sécurité vérifiables

Les invariants suivants DOIVENT être testables via le Conformance Test Model v1 (oracles + normalisation), et reliés explicitement aux invariants globaux I-01..I-15 quand applicable.

## 10.1 Table de mapping (hardening → invariants globaux → oracles → sévérité)

Notation :
- Invariants globaux = I-01..I-15.
- Oracles = A (Receipt/Errors) | B (Replay/StateDump) | C (Projection/ViewModel) | D (Security/Non‑fuite).
- Sévérité : Critical | Structural | Regression.

### SH-MASK-TX-1 — Transaction masquée intégrale
- Maps to : I-04 (tx-closed), I-11 (mask non‑fuyant)
- Oracles : D (absence de fuite) + B (replay vs état filtré) + A (codes non révélateurs)
- Sévérité : Critical

### SH-CURSOR-1 — Curseurs filtrés par principal
- Maps to : I-11 (mask non‑fuyant), I-04 (tx-closed), I-03 (streams)
- Oracles : D (pas de trous observables) + A (cursorAfter admissible) + B (progression monotone)
- Sévérité : Critical

### SH-TX-1 / SH-TX-3 — tx-closed strict + cursor admissible
- Maps to : I-04 (tx-closed)
- Oracles : B (lecture ranges) + A (cursorAfter) + D (pas d’observable partiel)
- Sévérité : Critical

### SH-OBJ-4 / §6.1 — Ordre meta → graph (non contournable)
- Maps to : I-05 (meta → graph), I-06 (déterminisme)
- Oracles : B (replay) + A (trace reason codes si violation) + C (projection cohérente)
- Sévérité : Critical

### SH-RUNTIME-1 — Cache scoping (pas de cache cross-principal)
- Maps to : I-11 (mask non‑fuyant), I-13 (snapshots non canoniques)
- Oracles : D (non‑fuite via cache) + C (mêmes entrées ⇒ mêmes sorties par principal) + B (cache invalidable vs replay)
- Sévérité : Critical (si surface exposée), sinon Structural

### SH-EXPORT-1 — Export reconstruit sous visibilité
- Maps to : I-11 (mask non‑fuyant), I-06 (replay déterministe)
- Oracles : B (dump export = replay filtré) + D (absence d’IDs/indices) + A (erreurs non révélatrices)
- Sévérité : Critical

### SH-EXPORT-2 — Stratégie stable sur dépendances masquées
- Maps to : I-11 (mask non‑fuyant)
- Oracles : D (pas de canal latéral), B (stabilité inter-runs), A (erreur non révélatrice si refus)
- Sévérité : Structural (peut devenir Critical si exposé à large audience)

### SH-VIOL-1 / SH-VIOL-2 — Violations non révélatrices
- Maps to : I-11 (mask non‑fuyant), I-01 (séparation ontologique)
- Oracles : C (ViolationReport normalisé) + D (pas d’EntityRef révélatrice) + B (replay + projection)
- Sévérité : Structural

### §4.4.3 — Derived masqué si dépendance masquée
- Maps to : I-11 (mask non‑fuyant), I-01 (vue ≠ vérité)
- Oracles : C (ViewModel) + D (absence d’inférence) + B (rebuild vs incremental)
- Sévérité : Critical (si derived observable en UI), sinon Structural

### SH-OVL-1 / SH-OVL-3 — Overlay non révélateur + mapping sécurisé
- Maps to : I-01 (overlay non ontologique), I-11 (mask), I-09 (locking), I-10 (idempotence)
- Oracles : A (errors/receipts reason codes) + D (non‑fuite via erreurs/locks/mapping) + B (replay)
- Sévérité : Critical

### SH-OVL-2 — Commit overlay strict
- Maps to : I-15 (resolveRevision), I-09 (locking), I-10 (idempotence)
- Oracles : A (PRECONDITION codes) + B (replay state) + D (erreur non révélatrice si masqué)
- Sévérité : Structural

### SH-REV-1 — resolveRevision non révélateur
- Maps to : I-15 (resolveRevision), I-11 (mask)
- Oracles : D (indistinguabilité) + A (erreurs structurées) + B (déterminisme)
- Sévérité : Critical

### DENY-WINS — moindre privilège gagne
- Maps to : I-12 (deny‑wins)
- Oracles : A (résolution policies) + D (pas d’escalade) + B (replay)
- Sévérité : Structural

---

## 10.2 Invariants (liste opérationnelle)

## INV-SH-1 — Aucun event partiel
- Lecture EventStore / sync:poll ne retourne jamais une transaction partielle.

## INV-SH-2 — Aucun ID masqué exposé
- Aucune surface (sync, export, projection, erreurs, logs exposés) n’expose GraphID/EdgeID/EntityRef d’une cible masquée.

## INV-SH-3 — Curseurs filtrés monotones
- `K_principal` monotone, tx-closed, sans trous observables.

## INV-SH-4 — Transaction masquée intégrale
- Toute transaction touchant une cible masquée est omise entièrement pour ce principal.

## INV-SH-5 — Overlay commit strict
- Commit overlay échoue si divergence baseGraphRevision.

## INV-SH-6 — Export cohérent sous visibilité
- Export reconstruit depuis EventStream filtré ; état cohérent ; digests calculés sur l’état filtré.

## INV-SH-7 — Derived masqué si dépendance masquée
- Toute Derived dépendant d’une entité masquée est absente (ou remplacée par un Placeholder non révélateur) selon une règle stable.

## INV-SH-8 — Violations non révélatrices
- Violations ciblées masquées ; violations globales agrégées sans EntityRef.

## INV-SH-9 — resolveRevision non révélateur
- “inconnue” vs “non autorisée” indistinguables extérieurement.

## INV-SH-10 — Cache scoping
- Aucun cache filtré servi cross-principal.

### Lien conceptuel vers le modèle de conformité (5.3)
Ces invariants DOIVENT être traduits en tests contractuels et en checks d’intégration bout‑en‑bout (command → tx → event → runtime → projection → sync/export), en utilisant :

- la normalisation (IDs/timestamps/collections) ;
- les oracles A/B/C/D ;
- la classification Critical/Structural/Regression.

---

# 11. Limites assumées v1

- Pas de rebase overlay automatique.
- Pas d’ordre total inter-stream.
- Pas d’exactly-once réseau.
- Contraintes globales L3 non bloquantes.

Ces limites ne DOIVENT jamais introduire de fuite.

---

# 12. Conclusion normative

Security Hardening v1 verrouille explicitement :

- filtrage transactionnel strict
- curseurs filtrés par principal
- export reconstruit sous visibilité
- Derived dépendant masqué
- violations non révélatrices
- resolveRevision non révélateur
- séparation meta/graph inviolable

Toute déviation constitue une violation critique du modèle Mesh Explorer v1.


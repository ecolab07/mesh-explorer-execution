# Mesh Projection and Views Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: overlay_system_v\_1_5.md

# Mesh Explorer --- Overlay System v1.5

## Types

-   Draft
-   Hypothesis (promotion en Draft obligatoire avant commit)
-   Annotation

## Structure

Overlay { overlayId kind baseGraphRevision parentOverlayId? status
payload: DeltaSet \| AnnotationSet provenance? }

## DeltaSet

-   AddNode(tempId, TypeID, props)
-   AddEdge(tempEdgeId, fromId, toId, RelationType, props)
-   UpdateProps(targetId, patch)
-   DeleteNode(targetId)
-   DeleteEdge(targetId)

Nouveaux objets = OverlayLocalID jusqu'au commit.

## Application

ApplyOverlay(Graph@rev, Overlay) -\> OverlayGraphView

Projection opère sur OverlayGraphView.

## Commit

OverlayDelta → Intent → PermissionCheck → Command → MetaGraphValidation
→ Commit Graph

------------------------------------------------------------------------

## Source: projection_dsl_v\_1.md

# Mesh Explorer --- Mini-DSL de Projection (Spec v1)

## Signature

Projection(Graph, MetaGraph, Params) -\> ViewModel

## Propriétés

-   Pure (aucun effet sur Graph)
-   Composable (pipeline de passes)
-   Rejouable (params sérialisables)
-   Traçable (provenance obligatoire pour Derived)

## Sorties Typées

-   RealNode(GraphID)
-   RealEdge(EdgeID)
-   DerivedNode(DerivedID, provenance)
-   DerivedEdge(DerivedID, provenance)
-   OverlayNode(OverlayID, target?, provenance)
-   Placeholder

## Pipeline

scope → match → expand → where → derive → select → decorate → layout

## Invariants

1.  scope présent exactement une fois.
2.  Aucun write vers Graph.
3.  Derived sans provenance = erreur.
4.  expand borné.
5.  select explicite.

------------------------------------------------------------------------

## Source: projection_engine_v\_1.md

# PROJECTION ENGINE v1 --- Livrable

## Positionnement

> Le Projection Engine reconstruit des **vues dérivées** à partir de :
>
> -   l'**EventStore** (historique immuable)
> -   un **LogicalSnapshot** (Type Engine + ContextSpace)
>
> Il ne modifie jamais la réalité ontologique.

------------------------------------------------------------------------

# Entrées / Sorties

## Entrées

``` txt
EventStream: Event[]
LogicalSnapshot: LogicalState
ProjectionSpec: ProjectionDefinition
```

## Sortie

``` txt
GraphStateView: ProjectionCache
```

> GraphStateView est un **cache matérialisé en mémoire**,
> invalide/recalculable.

------------------------------------------------------------------------

# Propriété maîtresse

``` txt
Projection = f(EventStream, LogicalSnapshot)
```

Conséquence : - même EventStream + LogicalSnapshot différent ⇒ vues
différentes - même EventStream + même LogicalSnapshot ⇒ déterminisme

------------------------------------------------------------------------

# Stratégie de reconstruction (choix validé)

## Runtime normal (B)

> Mise à jour incrémentale des entités impactées.

-   on applique les deltas issus des mutations
-   on recalcule uniquement les sous-ensembles dépendants

## Chargement / recovery (C)

> Snapshot périodique + rejouage partiel.

-   on charge un snapshot non canonique
-   on rejoue les événements depuis la position du snapshot

------------------------------------------------------------------------

# Cache de projection

## Définition

``` txt
ProjectionCache {
  id
  projectionSpecId
  logicalSnapshotRef
  baseSnapshotRef?

  materializedState
  derivedProps
  indexes

  validity {
    eventCursor
    logicalCursor
    invalidationReasons[]
  }
}
```

## Règle

-   **cache** tant que la vue est ouverte
-   **invalidable** à la demande ou automatiquement
-   **reconstructible** à partir (EventStore + LogicalSnapshot)

------------------------------------------------------------------------

# Multiples projections

-   plusieurs projections actives en parallèle : **oui**
-   LogicalSnapshot partagé par défaut
-   une projection peut sélectionner un autre contexte **explicitement**

``` txt
ProjectionInstance {
  projectionSpecId
  contextOverride?
}
```

------------------------------------------------------------------------

# Contexte en projection (simulation)

## Règle

> Une projection peut choisir un autre ContextSpace
> (preview/simulation), explicitement.

Exemple : - Contexte actif : `Production` - Projection :
`Preview_Regime_Futur`

Aucune mutation n'est produite.

------------------------------------------------------------------------

# Incohérence rétroactive (L0 valide, L1 invalide)

## Règle

> La projection **affiche l'état historique**.

Puis : - **signale** les violations sous le LogicalSnapshot courant -
**propose** des migrations (mutations explicites) - ne bloque pas par
défaut

## Artefact produit

``` txt
ViolationReport {
  entityRef
  ruleRef
  severity
  explanation
  suggestedMigrations[]
}
```

------------------------------------------------------------------------

# Dérivations temporaires (non persistées)

Autorisé : - score - clusters - regroupements - annotations de vue -
métriques

``` txt
DerivedProp {
  name
  compute(graphState, context)
  scope
}
```

Aucune écriture dans le Graph.

------------------------------------------------------------------------

# Identité projetée

-   identité = identique (id technique)
-   enrichissement dérivé = autorisé

Exemple : - réel : `{ id: 42 }` - vue :
`{ id: 42, depth, cluster, uiColor }`

Les propriétés dérivées n'ont pas de statut ontologique.

------------------------------------------------------------------------

# Projections définies hors-graph

Choix v1 : - ProjectionSpec défini **hors-graph** - DSL interne possible
plus tard (mise en abyme), non fondation

------------------------------------------------------------------------

# Composition de projections

Autorisé : projections composables en pipeline.

``` txt
Pipeline {
  stages[]: ProjectionStage
}

ProjectionStage {
  input: base | stage(n)
  transform
}
```

Exemples : - Hiérarchie → FS - Hiérarchie → Temporel - Nettoyage →
Symbolique

Composabilité toujours **explicite**.

------------------------------------------------------------------------

# Snapshots (persistance non canonique)

Accepté si : - non canonique - invalidable - reconstructible

``` txt
ProjectionSnapshot {
  projectionSpecId
  logicalSnapshotRef
  eventCursor
  data
}
```

Règle : - un snapshot n'est jamais une source de vérité - il accélère
uniquement

------------------------------------------------------------------------

# Interface minimale (API)

## Construire / ouvrir une projection

``` txt
openProjection(specId, { contextOverride? }) -> ProjectionInstance
```

## Mettre à jour (delta)

``` txt
applyEventDelta(projectionInstance, newEvents[]) -> void
```

## Rebuild (recovery / invalidation)

``` txt
rebuildProjection(projectionInstance, { fromSnapshot? }) -> void
```

## Rapports

``` txt
getViolationReport(projectionInstance) -> ViolationReport[]
```

------------------------------------------------------------------------

# Garanties

-   déterminisme (à LogicalSnapshot fixe)
-   non-canonicalité (projection ≠ vérité)
-   reconstructibilité
-   auditabilité (violations explicables)
-   support simulation (context override)
-   performance (delta + snapshot)

------------------------------------------------------------------------

# Résumé

Le Projection Engine v1 est :

-   un moteur **read-only**
-   reconstructible depuis (EventStore + LogicalSnapshot)
-   incrémental au runtime
-   snapshoté au recovery
-   multi-vues
-   supporte la simulation par contexte explicite
-   signale les incohérences et propose migrations
-   enrichit les entités par propriétés dérivées
-   compose des pipelines de projections

Sans jamais confondre vue et réalité.

------------------------------------------------------------------------

## Source: view_system_v\_1_architecture.md

# Mesh Explorer --- View System v1

# 1. Architecture Stratifiée

MetaGraph (types, contraintes, invariants) ↓ Graph (instances réelles) ↓
Projection Engine ↓ ViewModel (Real / Derived / Overlay / Placeholder) ↓
ViewPreset (artefact persisté) ↓ UIState (éphémère)

## Invariant Fondamental

La Vue ne possède aucune autorité ontologique. Seul le Graph validé par
le MetaGraph définit la vérité.

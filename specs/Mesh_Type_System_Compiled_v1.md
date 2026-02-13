# Mesh Type System Compiled v1

Status: Compilé (verbatim, sans modification)

------------------------------------------------------------------------

## Source: type_engine_v\_1.md

# TYPE ENGINE v1 --- Livrable

## Définition

> Le Type Engine est le moteur qui transforme les **types** en
> **systèmes actifs**. Il n'administre pas des labels, il orchestre des
> lois locales.

Un type n'est pas descriptif. Un type est **opératif**.

------------------------------------------------------------------------

# Ontologie du Type

``` txt
Type = Entité ontologique active
```

Un Type contient :

-   identité technique
-   hiérarchie
-   priorités
-   règles
-   contraintes
-   comportements
-   interprétations
-   mécanismes de résolution
-   politiques de conflit
-   propagation
-   héritage
-   override local
-   contextualisation

------------------------------------------------------------------------

# Modèle structurel

``` txt
Type {
  id
  name
  parentTypes[]
  priority

  schema
  constraints
  rules
  behaviors
  interpreters

  conflictPolicy
  compatibility
  propagationRules

  inheritancePolicy
  overridePolicy
  compositionRules

  contextBindings
}
```

------------------------------------------------------------------------

# Hiérarchie

-   Graphe de types (pas arbre strict)
-   Héritage multiple autorisé
-   Résolution par graphe dirigé
-   Pas de hiérarchie implicite

``` txt
TypeGraph = Directed Acyclic Graph (logique)
```

------------------------------------------------------------------------

# Priorités

Définies **dans le type**.

``` txt
priority: number
```

Utilisation :

-   ordonnancement des règles
-   résolution de conflits
-   arbitrage d'héritage
-   composition

------------------------------------------------------------------------

# Règles (Rules)

``` txt
Rule {
  id
  trigger
  condition
  action
  priority
  scope
}
```

Types de règles :

-   validation
-   propagation
-   transformation
-   interprétation
-   blocage
-   alerte

------------------------------------------------------------------------

# Contraintes

``` txt
Constraint {
  id
  expression
  severity
  scope
}
```

Severity :

-   hard (bloquant)
-   soft (signalement)
-   advisory (information)

------------------------------------------------------------------------

# Comportements

``` txt
Behavior {
  id
  input
  output
  effect
}
```

Effets possibles :

-   mutation
-   projection
-   signal
-   proposition

------------------------------------------------------------------------

# Interprétation

Un type **interprète** le réel.

``` txt
Interpreter {
  input
  context
  output
}
```

Exemples :

-   sémantique
-   symbolique
-   narrative
-   logique
-   UI
-   FS

------------------------------------------------------------------------

# Compatibilité

``` txt
Compatibility {
  withType
  mode: compatible | incompatible | conditional
  conditions
}
```

------------------------------------------------------------------------

# Conflits

``` txt
ConflictPolicy {
  mode:
    - block
    - propose
    - ask
    - auto

  resolutionOrder[]
}
```

------------------------------------------------------------------------

# Propagation

``` txt
PropagationRule {
  sourceType
  targetRelationType
  targetType
  mode
}
```

Modes :

-   none
-   weak
-   strong
-   forced

------------------------------------------------------------------------

# Héritage

``` txt
InheritancePolicy {
  merge
  override
  priorityRule
}
```

------------------------------------------------------------------------

# Override local

``` txt
Override {
  scope
  ruleOverride
  constraintOverride
  behaviorOverride
}
```

------------------------------------------------------------------------

# Composition

``` txt
CompositionRule {
  types[]
  resultType
  strategy
}
```

Strategies :

-   union
-   intersection
-   dominance
-   contextual

------------------------------------------------------------------------

# Contextualisation

``` txt
ContextBinding {
  context
  typeVariant
}
```

------------------------------------------------------------------------

# Cycle d'exécution

``` txt
Mutation → Type Engine
  → resolveTypes()
  → loadRules()
  → orderByPriority()
  → validate()
  → applyConstraints()
  → detectConflicts()
  → proposeResolutions()
  → emitDecisions()
  → authorizeMutation()
```

------------------------------------------------------------------------

# Propriétés

-   déterministe
-   explicable
-   inspectable
-   traçable
-   composable
-   reconstructible
-   non-magique
-   non-autoritaire

------------------------------------------------------------------------

# Lois

1.  Le type est une loi locale
2.  Le type ne décide pas, il cadre
3.  Le type n'impose pas, il structure
4.  Le type propose, explique, alerte
5.  La décision appartient toujours à l'utilisateur

------------------------------------------------------------------------

# Rôle systémique

Le Type Engine devient :

> Un moteur de gouvernance ontologique distribuée

Ce n'est pas un validateur. Ce n'est pas un contrôleur. Ce n'est pas un
système expert.

C'est un **système de lois locales explicables**.

------------------------------------------------------------------------

# Interfaces prévues

-   API Type Engine
-   UI Type System
-   DSL Type
-   Projection Engine
-   Mutation Engine
-   EventStore

------------------------------------------------------------------------

# Compatibilité

Compatible nativement avec :

-   Mutation Engine v1
-   EventStore
-   Projection System
-   Graph Runtime (futur)
-   Versioning natif (futur)

------------------------------------------------------------------------

# Résumé

Le Type Engine transforme l'ontologie en système vivant :

-   les nodes restent neutres
-   les relations portent le sens
-   les types portent les lois
-   les mutations portent le changement
-   l'EventStore porte la mémoire
-   les projections portent la lecture

Le réel devient programmable. Pas magique. Pas opaque. Pas autoritaire.

Structuré. Lisible. Gouvernable.

------------------------------------------------------------------------

## Source: meta_constraints_language_v\_1.md

# Mesh Explorer --- MetaConstraints Language v1

Décisions actées : - **DSL texte minimal** (lisible, versionnable,
diffable) - **Validation sync** pour **Niveau 1/2**, **async** pour
**Niveau 3** (avec statut)

------------------------------------------------------------------------

## 1) Niveaux de contraintes (par coût / portée)

### Niveau 1 --- Structural (local, indexable)

Vérifications locales sur une instance, sans traversal non borné. -
required/optional - type de champ - bornes numériques - unicité simple
(index) - cardinalité relationnelle simple (locale)

**Exemples**

``` txt
constraint Person.EmailRequired {
  scope type Person
  assert Person.email != null
}

constraint Person.EmailUnique {
  scope type Person
  assert unique(Person.email)
}

constraint Person.ManagerRequired {
  scope type Person
  assert count(outgoing reports_to) = 1
}
```

### Niveau 2 --- Relational (borné, localement étendu)

Traversal borné, prédicats conditionnels, cross-edge simple. - if/then -
contraintes sur voisins via relation(s) - égalités entre propriétés de
nœuds reliés - cardinalités conditionnelles

**Exemples**

``` txt
constraint Person.ActiveMustHaveEmail {
  scope type Person
  assert if (Person.active = true) then (Person.email != null)
}

constraint ProjectMemberOrgConsistency {
  scope rel has_member
  for (Project)-[has_member]->(Person)
  assert Project.org_id = Person.org_id
}

constraint CEOHasNoManager {
  scope type Person
  assert if (Person.role = "CEO") then (count(outgoing reports_to) = 0)
}
```

### Niveau 3 --- Global (coûteux, non borné / agrégations)

Règles globales : cycles, agrégats massifs, reachability profonde.

**Exemples**

``` txt
constraint NoCircularManagement {
  scope type Person
  level 3
  assert not exists cycle(Person, reports_to)
}

constraint OrgBudgetCap {
  scope type Org
  level 3
  assert sum(Project.budget where Project.org_id = Org.id) <= Org.max_budget
}
```

------------------------------------------------------------------------

## 2) DSL --- structure minimale

### 2.1 Bloc de contrainte

``` txt
constraint <Name> {
  scope <ScopeExpr>
  level <1|2|3>?          // optionnel; inféré si absent
  for <Pattern>?          // optionnel (pour contraintes sur motifs)
  assert <Expr>
  severity <error|warn>?  // optionnel
  message "..."?         // optionnel
}
```

### 2.2 ScopeExpr (obligatoire)

-   `type <TypeID>`
-   `rel <RelationTypeID>`
-   `context <ContextExpr>` (si vous avez des context scopes)

### 2.3 Pattern (optionnel)

-   `(A)-[r]->(B)` avec types : `(Project)-[has_member]->(Person)`

------------------------------------------------------------------------

## 3) Expressions (Expr) --- noyau safe

### 3.1 Opérateurs

-   Comparaison : `=`, `!=`, `<`, `<=`, `>`, `>=`
-   Booléens : `and`, `or`, `not`
-   Condition : `if (...) then (...) else (...)`

### 3.2 Fonctions (noyau)

-   `count(outgoing <rel>)`
-   `count(incoming <rel>)`
-   `exists(<Pattern where ...>)`
-   `unique(<fieldExpr>)` (Niveau 1 si indexable)

### 3.3 Fonctions Niveau 3 (global)

-   `cycle(<Type>, <rel>)`
-   `sum(<field> where <predicate>)`
-   `reachable(<root>, <rel>, <node>)` (si activé)

------------------------------------------------------------------------

## 4) Inférence de niveau (si level absent)

Heuristique conservative : - Niveau 1 : pas de `for`, pas de `exists`
non borné, pas d'agrégats globaux - Niveau 2 : `for` avec pattern
simple, `count` local, `exists` borné - Niveau 3 : `cycle`, `sum`
global, `reachable`, traversals non bornés

Si doute → classer en **Niveau 3**.

------------------------------------------------------------------------

## 5) Exécution / validation

### 5.1 Sync (Niveau 1/2)

-   validation immédiate à l'édition (ou au moins au "Validate Draft")
-   renvoie violations + reason codes

### 5.2 Async (Niveau 3)

-   job lancé au "Validate Draft" (ou à la demande)
-   statut attaché au draft :
    `pending | running | ok | violations | failed`
-   publication bloquée si statut ≠ ok

------------------------------------------------------------------------

## 6) Modèle de résultat (violations)

``` txt
Violation {
  constraintName
  level
  severity
  targetIds: [GraphID|EdgeID]    // si applicable
  message?
  reasonCode
  evidence?                      // trace minimale (safe)
}
```

Reason codes typiques : - META.CONSTRAINT.FIELD_REQUIRED -
META.CONSTRAINT.UNIQUE_VIOLATION - META.CONSTRAINT.CARDINALITY -
META.CONSTRAINT.CYCLE_DETECTED - META.CONSTRAINT.AGGREGATE_LIMIT

------------------------------------------------------------------------

## 7) UI Patterns (minimal)

-   **Constraint Editor** : bloc, scope, assert, niveau (auto +
    override)
-   **Cost badge** : L1/L2/L3 + estimation (fast/medium/slow)
-   **Validate** : résultats listés + navigation vers cibles
-   **Async status** : barre d'état, historique des runs

------------------------------------------------------------------------

## 8) Invariants

1.  DSL borné (pas de boucle, pas de récursion libre).
2.  Toute contrainte a un scope explicite.
3.  Niveau 3 toujours async avec statut.
4.  Publication interdite si Niveau 3 non validé ou en échec.
5.  Les violations sont inspectables et traçables.

------------------------------------------------------------------------

## Source: type_system_ui_v\_1_core.md

# Mesh Explorer --- Type System UI v1 (Core)

## Objet

Éditer le **MetaGraph** (la loi) via une UI, sans casser : - la
cohérence interne du MetaGraph - la compatibilité avec le Graph
existant - les permissions - la traçabilité/versionning

## Décisions actées

-   MetaGraph **versionné, immuable** (édition = nouvelle version)
-   modifications via **Draft + Commit**
-   validation = **cohérence interne + compatibilité Graph**
-   migrations **explicites** (pas de magie silencieuse)

------------------------------------------------------------------------

## 1) Modèle de données (noyau)

### 1.1 MetaGraphVersion

``` txt
MetaGraphVersion {
  metaVersionId
  parentMetaVersionId?
  createdAt
  author
  status: draft | published | deprecated
  modules: [MetaModule]
}
```

### 1.2 MetaModule

``` txt
MetaModule {
  moduleId
  types: [TypeDef]
  relations: [RelationDef]
  constraints: [ConstraintDef]
  permissions: [PolicyDef]
}
```

### 1.3 TypeDef

``` txt
TypeDef {
  typeId
  kind: NodeType | EdgeType | ContextType | DerivedType
  fields: [FieldDef]
  invariants: [InvariantDef]
  displayHints?   // non ontologiques, optionnel
}
```

### 1.4 RelationDef

``` txt
RelationDef {
  relationTypeId
  fromTypeId
  toTypeId
  cardinality?
  traversable?
  invariants: [InvariantDef]
}
```

------------------------------------------------------------------------

## 2) Pipeline d'édition (symétrique Graph/Overlay)

``` txt
UI → MetaIntent → PermissionCheck(meta) → MetaCommand
  → MetaValidation (internal)
  → GraphCompatibilityCheck
  → MigrationPlan (si requis)
  → Publish (nouvelle MetaGraphVersion)
```

### 2.1 MetaDraft

``` txt
MetaDraft {
  draftId
  baseMetaVersionId
  deltaSet  // opérations meta
  status: active | frozen | archived
}
```

------------------------------------------------------------------------

## 3) MetaDeltaSet (opérations autorisées)

### Types

-   AddType(typeId, kind)
-   RenameType(typeId, newId)
-   DeleteType(typeId)
-   AddField(typeId, fieldDef)
-   UpdateField(typeId, fieldId, patch)
-   DeleteField(typeId, fieldId)
-   AddInvariant(typeId, invariant)
-   DeleteInvariant(typeId, invariantId)

### Relations

-   AddRelation(relationDef)
-   UpdateRelation(relationTypeId, patch)
-   DeleteRelation(relationTypeId)

### Permissions

-   AddPolicy(policyDef)
-   UpdatePolicy(policyId, patch)
-   DeletePolicy(policyId)

------------------------------------------------------------------------

## 4) Validation (double)

### 4.1 MetaValidation --- cohérence interne

Exemples de codes : - META.INVALID.FIELD.TYPE - META.MISSING.TYPE -
META.RELATION.ENDPOINT.INVALID - META.INVARIANT.CONTRADICTION

### 4.2 GraphCompatibilityCheck --- compatibilité Graph

Sortie : - Compatible - CompatibleWithMigration - Incompatible

------------------------------------------------------------------------

## 5) Migration Plan (explicite)

``` txt
MigrationPlan {
  planId
  fromMetaVersionId
  toMetaVersionId
  steps: [MigrationStep]
  dryRunReport
}
```

Steps (noyau) : - SetDefaultField - BackfillField - TransformField -
CreateEdges - DeleteEdges - MapType

Règles : - migration = opérations sur Graph (donc Command Engine +
permissions) - migration dry-run - migration versionnée + inspectable

------------------------------------------------------------------------

## 6) UI minimale

-   MetaGraph Explorer (modules → types → champs → invariants →
    relations → policies)
-   Diff base vs draft
-   Editors (Type/Relation/Policy)
-   Workflow Publish : Validate → Compatibility → Migration plan →
    Dry-run → Publish

------------------------------------------------------------------------

## 7) Permissions Meta

-   meta.read
-   meta.draft.create
-   meta.draft.update
-   meta.validate
-   meta.publish
-   meta.migration.execute

------------------------------------------------------------------------

## 8) Invariants (non négociables)

1.  Pas de mutation in-place d'un MetaGraph publié.
2.  Toute modification passe par MetaDraft + validation.
3.  Publication seulement si validation OK et compatibilité ≠
    Incompatible.
4.  Migration explicite si nécessaire.
5.  La metaVersion utilisée est toujours inspectable.

------------------------------------------------------------------------

## Source: type_system_ui_v\_1_meta_draft_diff_and_conflicts.md

# Mesh Explorer --- Type System UI v1

## MetaDraft Diff & Conflits (Branch/Merge)

### Objectif

Gérer l'édition collaborative du MetaGraph via des **MetaDrafts**
versionnés, avec **diff sémantique** et **merge 3-way**.

------------------------------------------------------------------------

## 1) Principe

-   Base immuable : `MetaGraphVersion V0`
-   Draft = DeltaSet : `Δ`
-   Résultat : `Vdraft = Apply(V0, Δ)`

Le diff n'est pas textuel : il est **sémantique** (ID-based) sur objets
adressables.

------------------------------------------------------------------------

## 2) Représentation canonique : Semantic MetaDiff

### 2.1 Unité : MetaChange

``` txt
MetaChange {
  opId
  opType
  targetPath    // ex: Type(Person).Field(salary)
  before?       // snapshot minimal
  after?        // snapshot minimal
  intentTag?    // ex: strengthen-constraint, rename, deprecate
}
```

### 2.2 TargetPath (stable)

-   `Type(<typeId>)`
-   `Type(<typeId>).Field(<fieldId>)`
-   `Relation(<relationTypeId>)`
-   `Policy(<policyId>)`
-   `Invariant(<invariantId>)`

Règle : un objet sans ID stable = merge fragile / interdit.

------------------------------------------------------------------------

## 3) Catégories de conflits (noyau)

### 3.1 Conflits structurels (HARD)

-   Delete vs Update (même cible)
-   Rename divergence (deux renommages incompatibles)
-   Endpoint mismatch (from/to changés différemment)
-   Cardinality clash (1-n vs n-n)

Résolution : explicite via UI.

### 3.2 Conflits de propriétés (SOFT)

-   mêmes attributs modifiés différemment

Résolution : ours/theirs/merge manuel.

### 3.3 Conflits de contraintes (CONSTRAINT)

-   contradictions après fusion
-   dépendances implicites cassées

Résolution : via MetaValidation + diagnostics.

### 3.4 Conflits de permissions (SECURITY)

-   ouverture vs fermeture sur même cible

Règle par défaut : **deny wins** (moindre privilège), mais visible.

------------------------------------------------------------------------

## 4) Branching & merge

### 4.1 Branch

-   `Draft D1` base `V0`
-   `Draft D2` parent `D1` (ou base `V0`)

### 4.2 Merge 3-way

-   Base = V0
-   Ours = Apply(V0, Δours)
-   Theirs = Apply(V0, Δtheirs)

Par `targetPath` : 1) un seul côté modifie → appliquer 2) les deux
modifient → fusion si compatible sinon conflit

Sortie :

``` txt
MergeResult {
  mergedDeltaSet
  conflicts: [MetaConflict]
}
```

------------------------------------------------------------------------

## 5) MetaConflict

``` txt
MetaConflict {
  conflictId
  targetPath
  kind: HARD | SOFT | SECURITY | CONSTRAINT
  oursChange
  theirsChange
  suggestedResolutions: [ResolutionOption]
  reasonCodes: [ReasonCode]
}
```

Reason codes typiques : - META.MERGE.DELETE_UPDATE -
META.MERGE.RENAME_DIVERGENCE - META.MERGE.PERMISSION_CLASH -
META.MERGE.CONSTRAINT_INCOMPATIBLE

------------------------------------------------------------------------

## 6) Résolution UI (minimale)

### 6.1 MetaDiff view

-   arbre module → type → champ → relation → policy
-   ajout/modif/suppression
-   conflits (icône)
-   impact (blast radius)

### 6.2 Résolution

-   prendre ours
-   prendre theirs
-   fusion manuelle (éditeur structuré)
-   drop change

------------------------------------------------------------------------

## 7) Blast radius (Impact map)

Calcul minimal à chaque diff :

``` txt
ImpactSummary {
  affectedTypes: n
  affectedRelations: n
  compatibility: Compatible | WithMigration | Incompatible
  requiresMigration: bool
  securityImpact: none | low | high
}
```

Important : stats filtrées pour éviter fuite (objets masqués).

------------------------------------------------------------------------

## 8) Invariants

1.  Diff sémantique uniquement (ID-based).
2.  Merge produit un nouveau DeltaSet.
3.  Conflits permissions : deny wins par défaut.
4.  Conflits contraintes : tranchés par MetaValidation.
5.  Résolutions historisées (audit).

------------------------------------------------------------------------

## Source: type_system_ui_v\_1_uipatterns_impact_map.md

# Mesh Explorer --- Type System UI v1

## UI Patterns + Impact Map (Blast Radius)

### Objectif

Rendre l'édition du MetaGraph **non ambiguë** : chaque changement doit
afficher clairement : - ce qui change (diff sémantique) - ce que ça
casse potentiellement (compatibilité) - ce que ça impose (migrations) -
ce que ça affecte côté sécurité (permissions)

Approche "probable" : UI par **workflows** + **garde-fous**
(validate/publish), et impacts calculés par un moteur.

------------------------------------------------------------------------

## 1) Surfaces UI minimales (v1)

### 1.1 MetaGraph Explorer

-   Arbre : Modules → Types → Fields → Invariants → Relations → Policies
-   Indicateurs : (A) ajouté, (M) modifié, (D) supprimé
-   Filtre : show changes only

### 1.2 Draft Workspace

-   Bandeau : baseMetaVersionId, draftId, auteur, état (active/frozen)
-   Boutons : Validate, Compatibility Check, Generate Migration, Publish
-   Historique : liste des MetaChanges (audit)

### 1.3 Structured Editors

#### Type Editor

-   Fields (table)
-   Invariants (liste)
-   Deprecate/rename (opérations explicites)

#### Relation Editor

-   fromType / toType
-   cardinality
-   traversable (hint)
-   invariants

#### Policy Editor

-   cibles (type/field/relation/scope)
-   actions (read/traverse/create/update/delete/commit)
-   effect (allow/deny/mask)
-   règles ABAC (attributs)

### 1.4 Constraint Editor

-   DSL texte minimal
-   scope + niveau (auto + override)
-   bouton "Test" (sync L1/L2)
-   bouton "Run async" (L3)

------------------------------------------------------------------------

## 2) Pattern central : Change Cards

Chaque modification affichée sous forme de carte structurée :

``` txt
ChangeCard {
  targetPath
  changeType: add | update | delete | rename
  summary
  impactBadges: [compat, migration, security]
  details (before/after)
  actions: revert | edit | open impact
}
```

Exemples de badges : - Compat: OK / WithMigration / Incompatible -
Migration: Required / None - Security: None / Low / High

------------------------------------------------------------------------

## 3) Impact Map (Blast Radius)

### 3.1 But

Associer à chaque MetaChange une estimation d'impact, puis agréger au
niveau du draft.

### 3.2 Sortie standard

#### Par changement

``` txt
ChangeImpact {
  targetPath
  affectedInstanceEstimate
  affectedRelationsEstimate
  violationRisk: low | medium | high
  requiresMigration: bool
  securityImpact: none | low | high
  projectionImpact: none | low | high
  reasonCodes: [ImpactReason]
}
```

#### Global draft

``` txt
DraftImpact {
  compatibility: Compatible | WithMigration | Incompatible
  requiresMigration: bool
  securityImpact: none | low | high
  estimatedViolations: n?
  asyncConstraintsPending: bool
}
```

### 3.3 Estimation "probable" (v1)

Sans calcul exact : - utiliser indexes/stats existants (comptages par
type/rel) - échantillonnage (sampling) si volumineux - pour champs :
nombre d'instances du type - pour relations : nombre d'arêtes du type

### 3.4 ImpactReason codes (exemples)

-   IMPACT.FIELD.REQUIRED_ADDED
-   IMPACT.FIELD.TYPE_CHANGED
-   IMPACT.RELATION.DELETED
-   IMPACT.CARDINALITY.TIGHTENED
-   IMPACT.PERMISSION.OPENED
-   IMPACT.PERMISSION.RESTRICTED
-   IMPACT.CONSTRAINT.LEVEL3_PENDING

------------------------------------------------------------------------

## 4) Workflows guidés (garde-fous)

### 4.1 Validate Draft

-   Exécute MetaValidation
-   Exécute contraintes L1/L2 (sync)
-   Déclenche jobs L3 (async) si présents

Affiche : - erreurs bloquantes - warnings - statut async
(pending/running/ok/violations)

### 4.2 Compatibility Check

-   Exécute GraphCompatibilityCheck
-   Alimente DraftImpact

### 4.3 Generate Migration

-   Propose un plan (assisté) basé sur les ChangeImpact
-   Forçage explicite si ambigu (ex: required sans default)

### 4.4 Dry-run Migration

-   Simule sur un snapshot/révision
-   Produit un rapport : success/violations/conflicts

### 4.5 Publish

Conditions minimales : - MetaValidation OK - Compatibilité ≠
Incompatible - Contraintes L3 : statut OK (aucun pending) - Migration
plan prêt si requiresMigration

------------------------------------------------------------------------

## 5) Patterns d'ambiguïté interdite (anti-pièges)

1.  **Renommer** ≠ supprimer+ajouter (doit être une opération dédiée)
2.  **Required** sans default/backfill → bloquant (ou migration
    obligatoire)
3.  **Permission change** doit afficher "opened/closed" explicitement
4.  **DeleteType** si instances existantes → interdit ou migration
    mapping obligatoire
5.  **Constraint L3** → publication bloquée tant que non validée

------------------------------------------------------------------------

## 6) Security UX (probable)

### 6.1 Permission Diff View

-   liste des cibles affectées
-   matrice actions × cibles
-   indicateur "opened" / "restricted"

### 6.2 Default safety

-   En cas de conflit : **deny wins**
-   Toute ouverture de droit = securityImpact high + confirmation dans
    workflow

------------------------------------------------------------------------

## 7) Projection / View impact (non bloquant mais visible)

Même si projection est "séparée", des changements meta peuvent casser
des vues : - rename field/type utilisé par une projection

Approche v1 probable : - analyser references
(typeId/fieldId/relationTypeId) dans ViewPresets - lister vues
potentiellement cassées : `projectionImpact = high`

------------------------------------------------------------------------

## 8) Invariants UI

1.  Toute modification est visible comme ChangeCard.
2.  Chaque ChangeCard expose un Impact (au moins estimé).
3.  Publish n'est jamais un bouton "magique" : il reste un pipeline.
4.  Les impacts security et migration sont toujours explicités.
5.  Les statuts async (L3) sont visibles et bloquants.

------------------------------------------------------------------------

## Source: mesh_explorer_type_system_ui_v\_1_refactoring_ops.md

# Mesh Explorer --- Type System UI v1

## MetaGraph Refactoring Ops (first-class)

### Objectif

Modéliser explicitement les opérations **dangereuses**
(rename/split/merge/deprecate/move) pour éviter :

-   les faux diffs (delete+add)
-   les migrations implicites
-   les merges impossibles
-   la casse silencieuse de vues/permissions

Approche "probable" : refactor ops = **MetaCommands** dédiés, traçables,
avec migrations associées.

------------------------------------------------------------------------

## 1) Principe : refactor ≠ patch naïf

Un refactor est un **événement sémantique** qui :

-   transforme le MetaGraph
-   produit (souvent) un **MigrationPlan**
-   fournit une **mapping table** (old→new)

Donc on l'exprime comme une op dédiée, pas comme : Delete + Add.

------------------------------------------------------------------------

## 2) Catalogue d'opérations (v1)

### 2.1 RenameType

``` txt
RenameType {
  oldTypeId
  newTypeId
  keepAlias?: bool        // optionnel: alias temporaire
}
```

**Effets**

-   Meta: remplace les références
-   Migrations: en général aucune sur instances (type identity logique),
    mais :
    -   mise à jour des références dans ViewPresets/Policies/Constraints

**Impact**

-   projectionImpact souvent high

### 2.2 RenameField

``` txt
RenameField {
  typeId
  oldFieldId
  newFieldId
  keepAlias?: bool
}
```

**Effets**

-   Meta: champ renommé
-   Migration: possible (copie old→new puis deprecate old)

### 2.3 DeprecateType / DeprecateField

``` txt
DeprecateType { typeId, sunsetDate? }
DeprecateField { typeId, fieldId, sunsetDate? }
```

**Effets**

-   Meta: marque comme deprecated
-   UI: warnings
-   Publish: autorisé
-   Suppression réelle (Delete) = étape ultérieure, exige migration

### 2.4 MoveTypeToModule

``` txt
MoveTypeToModule { typeId, fromModuleId, toModuleId }
```

**Effets**

-   Meta: réorganisation
-   Instances: aucune
-   Merge: important (ownership)

### 2.5 SplitType (type → plusieurs)

``` txt
SplitType {
  sourceTypeId
  targets: [ { newTypeId, predicateExpr } ]
  defaultTarget?
}
```

**Effets**

-   Meta: nouveau(x) type(s)
-   Migration: obligatoire (MapType par prédicat)
-   Compat: WithMigration

### 2.6 MergeTypes (plusieurs → un)

``` txt
MergeTypes {
  sourceTypeIds: [..]
  targetTypeId
  fieldMapping: [ {fromType, fromField, toField, transformExpr?} ]
}
```

**Effets**

-   Meta: type cible enrichi
-   Migration: obligatoire (MapType + TransformField)

### 2.7 ChangeFieldType

``` txt
ChangeFieldType {
  typeId
  fieldId
  fromScalarType
  toScalarType
  transformExpr?
}
```

**Effets**

-   Migration: souvent obligatoire
-   Compat: WithMigration ou Incompatible

### 2.8 TightenCardinality / LoosenCardinality

``` txt
TightenCardinality { relationTypeId, fromCard, toCard }
LoosenCardinality { relationTypeId, fromCard, toCard }
```

**Effets**

-   Tighten: migration/cleanup requise si violations
-   Loosen: généralement compatible

### 2.9 ChangeRelationEndpoints

``` txt
ChangeRelationEndpoints { relationTypeId, fromTypeId?, toTypeId? }
```

**Effets**

-   Migration: re-map edges ou delete invalid
-   Très conflict-prone

------------------------------------------------------------------------

## 3) Artifacts produits par une refactor op

### 3.1 Mapping Table

``` txt
RefactorMapping {
  opId
  mappings: [ {oldRef, newRef, kind} ]
  kind: alias | rename | split | merge
  validityWindow?
}
```

### 3.2 MigrationPlan (si requis)

-   backfill
-   transform
-   map type
-   edge remap

------------------------------------------------------------------------

## 4) Interaction avec Diff/Merge

### 4.1 Diff

-   Une refactor op apparaît comme **une seule ChangeCard**
-   Le diff montre : intention + before/after + mapping

### 4.2 Merge

-   Deux refactors sur même cible = conflit HARD (souvent) Exemples :
-   RenameType divergence
-   SplitType vs MergeTypes

Règle probable :

-   refactor ops ont priorité dans le merge; si collision → conflit
    explicite

------------------------------------------------------------------------

## 5) Interaction avec Permissions

-   Rename/split/merge doivent mettre à jour automatiquement les
    références policy (ou produire tâches de remédiation)
-   Toute refactor qui **élargit** une cible (ex: merge types) doit
    recalculer securityImpact

------------------------------------------------------------------------

## 6) Interaction avec ViewPresets/Projections

Approche v1 probable :

-   analyser les références dans ViewPresets
-   produire une liste : "views potentially broken"
-   proposer une auto-fix (remap via mapping table) quand possible

------------------------------------------------------------------------

## 7) Garde-fous UI (obligatoires)

1.  Refactor ops accessibles via actions dédiées (pas via édition libre
    seulement)
2.  Chaque refactor génère une **Impact Map** riche
3.  Si migration requise → workflow obligatoire (Generate/Dry-run)
4.  Aliases temporaires (keepAlias) optionnels pour transition (avec
    sunset)
5.  Suppression finale (Delete) interdite tant que dépendances non
    résolues

------------------------------------------------------------------------

## 8) Doutes possibles (defaults)

### Doute A --- Aliases temporaires

Décision : **autoriser **\`\` pour rename field/type.

-   Recommandation : exiger `sunsetDate` (ou une fenêtre de validité) et
    marquer l'alias `deprecated`.
-   Inspection : l'alias doit être visible comme mapping (old→new) dans
    l'inspection/diff.

### Doute B --- Auto-remap des ViewPresets

Décision : **Cas 3 --- ne rien faire en v1**.

-   Le système **signale** les vues/projections potentiellement cassées
    (projectionImpact = high), sans proposer de correctif.
-   Préparer le terrain pour une V2 "suggestions" :
    -   produire la **liste des références cassées**
        (typeId/fieldId/relationTypeId)
    -   exposer une **mapping table** (refactor mapping) exploitable
        plus tard par un moteur de suggestions
    -   conserver l'audit des impacts (Impact Map).

------------------------------------------------------------------------

## 9) Invariants

1.  Rename/split/merge sont first-class (jamais encodés en delete+add).
2.  Refactor op → mapping table inspectable.
3.  Si migration requise, publication bloquée tant que migration non
    validée.
4.  Impacts security/projection toujours recalculés.

# mesh-explorer-execution — inventaire et rôle (snapshot)

## 1) Inventaire structuré

### 1.1 Packages / apps présents

**Apps** (`apps/*`)

- `apps/mesh-app` (`@mesh/mesh-app`): CLI applicative de démonstration (create/list/delete/watch) vers serveur notes. Entrée binaire `mesh-app`.
- `apps/mesh-notes-server` (`@mesh/notes-server`): serveur HTTP de référence pour l'app notes, avec proxy des routes `/v1/*` vers l’adaptateur sync HTTP.
- `apps/mesh-notes-replica` (`@mesh/notes-replica`): réplica client (poll + SSE) avec persistance de curseur.
- `apps/mesh-notes`: dossier de documentation du skeleton notes (pas de `package.json` dans ce dossier).

**Packages** (`packages/*`)

- `packages/shared` (`@mesh/shared`): types/raison-codes partagés.
- `packages/eventstore-local` (`@mesh/eventstore-local`): EventStore local (fichier, mémoire, IndexedDB).
- `packages/kernel-minimal` (`@mesh/kernel-minimal`): exécution minimale des commandes.
- `packages/projection-minimal` (`@mesh/projection-minimal`): projection minimale avec snapshots.
- `packages/snapshot-minimal` (`@mesh/snapshot-minimal`): store de snapshots.
- `packages/runtime-local` (`@mesh/runtime-local`): runtime local assemblant kernel + store + projection + snapshots.
- `packages/sync-local` (`@mesh/sync-local`): harness/transport sync local.
- `packages/sync-http` (`@mesh/sync-http`): adaptateur transport HTTP/SSE de référence.
- `packages/cli` (`@mesh/cli`): CLI `mesh` (write/read/status).
- `packages/conformance-harness` (`@mesh/conformance-harness`): utilitaires d’assertion/normalisation conformance.
- `packages/conformance-tests` (`@mesh/conformance-tests`): suites de tests de conformance.

### 1.2 Points d’entrée (bin, server, CLI)

- CLI principale: `mesh` via `packages/cli/package.json` (`bin.mesh -> ./dist/bin/mesh.js`).
- CLI app demo: `mesh-app` via `apps/mesh-app/package.json` (`bin.mesh-app -> ./dist/index.js`).
- Entrée serveur notes exécutable: `apps/mesh-notes-server/src/index.ts` (bloc `if (process.argv[1] ... )`).
- Runtime API (lib): `createRuntimeLocal()` exportée par `packages/runtime-local/src/index.ts`.
- Adaptateur serveur sync HTTP: `SyncHttpReferenceServer` (`packages/sync-http/src/index.ts`) avec routes:
  - `commands:submit`
  - `sync:pull`
  - `sync:subscribe`
  - `events:read`
  - `sync:poll`.

### 1.3 Rôle des dossiers majeurs

- `apps/`: skeleton applicatif de démonstration (notes) pour intégrer le runtime/sync.
- `packages/`: briques runtime + transport + conformance + CLI.
- `contracts/v1/`: gel de surface API publique v1 (golden/generated, manifest, policy).
- `docs/`: docs d’intégration et garanties opérationnelles.
- `tests/e2e/`: scénarios E2E du skeleton app (CRUD, restart, isolation principal).
- `scripts/`: smoke, bench, release, migration, checks packaging.
- `tools/ci/`: checks de contrat API, reason-codes, exports publics.
- `artifacts/`: sorties de preuve conformance.
- `specs/`: référentiel normatif compilé (inclut execution/product/application).

### 1.4 Dépendances internes et externes

- Dépendances internes (`@mesh/*`) observées dans les manifests:
  - `@mesh/shared`, `@mesh/eventstore-local`, `@mesh/kernel-minimal`, `@mesh/projection-minimal`, `@mesh/snapshot-minimal`, `@mesh/runtime-local`, `@mesh/sync-local`, `@mesh/sync-http`, `@mesh/conformance-harness`.
- Dépendances externes directes visibles au root:
  - `typescript`, `vitest` (+ optionnelles `@esbuild/linux-x64`, `@rollup/rollup-linux-x64-gnu`).
- Workspace pnpm: `packages/*` uniquement (les `apps/*` existent mais ne sont pas listées dans `pnpm-workspace.yaml`).

### 1.5 Scripts build / test / run

- Root:
  - build global: `pnpm -r build`
  - test principal: `pnpm -r build && pnpm --filter @mesh/conformance-tests test`
  - test all: `pnpm -r test`
  - checks: packaging/API/reason-codes/exports publics
  - bench: cold-start, compare backends, perf, replica-catchup, snapshot-maintenance.
- Paquets:
  - la plupart des packages: `build` + `test` (Vitest).
  - `@mesh/conformance-tests`: `test`, `check:critical`, `check:artifacts-clean`, génération d’evidence.
- Apps:
  - `@mesh/mesh-app`: `build`, `start`
  - `@mesh/notes-server`: `build`, `start`
  - `@mesh/notes-replica`: `build`.

## 2) Rôle du repo dans l’architecture globale

## 2.1 Positionnement

Ce repo est **principalement le socle d’exécution + transport + conformance** (pas le produit UI final):

- moteur/runtime local: `eventstore-local`, `kernel-minimal`, `runtime-local`, `projection-minimal`, `snapshot-minimal`.
- adaptateurs transport/sync: `sync-local` + `sync-http` (HTTP/SSE).
- discipline de conformité: `conformance-harness` + `conformance-tests` + scripts/artefacts.
- surface d’usage minimale: CLI `mesh` + skeleton notes (`mesh-notes-server`, `mesh-app`, replica).

## 2.2 Produit vs infra/outillage

- **Produit (au sens utilisateur final):** seulement un skeleton notes CLI+HTTP (Phase 17 app skeleton), pas d’UI graph 2D/3D livrée ici.
- **Infra/outillage:** l’essentiel du repo (runtime, sécurité d’exécution, sync, conformance, gates release, contrats API, benchmarks).

## 3) Pourquoi ce repo était logique dans la trajectoire vers UI 3D graph

Le POC localStorage + UI ne suffit pas pour les invariants v1. Ce repo pose explicitement des contraintes d’exécution qui doivent exister **avant** une UI produit:

- append-only + tx-closed + ordre `meta -> graph` + replay déterministe.
- idempotence persistante et confirmation par receipt (pas ack transport).
- curseur principal-filtré (sécurité/masking non-fuyant).
- namespace `graphSpaceId` dès le départ.
- contrats run/recovery: poll source-of-truth, SSE best-effort, reprise sur curseur persisté.
- discipline de packaging/API et de conformance testable/reproductible.

Sans ces garanties, une UI 3D ferait un rendu “joli” mais non fiable (états partiels, fuite masked, divergence replay, etc.).

## 4) Ce qui manque encore pour le produit visé

Au regard des specs produit/application:

- UI 2D/3D de navigation graphe (Graph View + Panels + Inspector).
- modèle explicite Nodes/Links/relations typées côté expérience produit.
- workflows overlay/draft complets en UI (et leurs tests UI critiques).
- fonctionnalités de surface type fichiers/recherche non identifiées comme implémentées dans ce repo (ambigu: aucun package/app dédié “search” ou “files” n’est visible dans l’arborescence actuelle).

## 5) Recommandation de structure cible

## 5.1 Placement UI

Option pragmatique: ajouter une app UI dédiée dans un monorepo (ex. `apps/mesh-explorer-ui`) pour consommer les packages `@mesh/*` et garder la même CI/gates conformance.

Option alternative: repo séparé UI si séparation cycle produit/infra est prioritaire; garder ici les contrats et tests de conformité runtime.

## 5.2 Contrat d’intégration runtime/transport

- Consommer le runtime via HTTP/SSE de `@mesh/sync-http` (`commands:submit`, `sync:pull`, `sync:subscribe`).
- Traiter `sync:pull` comme source de vérité, SSE comme accélérateur best-effort.
- Persister les curseurs par principal côté client UI pour recovery.

## 5.3 Interfaces à stabiliser (à ne pas casser)

- Canon `Command / TransactionReceipt / CommandError`.
- Sémantique `reasonCode/category` (surface erreur).
- Sémantique curseurs filtrés principal et tx-closed.
- Contrat API public v1 (`contracts/v1`).

## 6) Ambiguïtés explicites (sans hypothèses)

- Le repo ne contient pas d’app UI web/desktop nommée explicitement “3D graph”; seules apps visibles sont notes-server / notes-replica / mesh-app CLI.
- La présence d’`apps/mesh-notes` est documentaire; le code exécutable est dans `apps/mesh-notes-server`, `apps/mesh-notes-replica`, `apps/mesh-app`.
- Les `apps/*` ne sont pas incluses dans `pnpm-workspace.yaml`; leur build est piloté indirectement (scripts/tsconfig locaux), ce qui peut surprendre si l’on s’attend à un workspace complet apps+packages.

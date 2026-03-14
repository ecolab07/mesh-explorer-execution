# CLAUDE.md — mesh-explorer

## Ce que tu dois savoir avant toute chose

Ce projet est un **cognitive graph engine**, pas une app UI.
La philosophie est structurante : chaque décision technique en découle.

| Concept       | Modèle mental               |
|---------------|-----------------------------|
| Graph         | espace cognitif             |
| DB            | mémoire                     |
| RAM           | conscience (état courant)   |
| 3D            | langage spatial             |
| Types         | lois                        |
| Relations     | forces                      |
| Projections   | points de vue               |
| Export        | photographie                |
| Import        | renaissance                 |

**Ne jamais traiter ce projet comme un CRUD classique.**

---

## Stack & environnement

- **Runtime** : Node 20.11.1 (`.nvmrc` fait référence — ne pas dévier)
- **Package manager** : pnpm 9.15.4 via Corepack
- **TypeScript** : ^5.6.3
- **Tests** : Vitest ^2.1.8
- **Monorepo** : pnpm workspaces

### Variables d'environnement

| Variable                              | Valeur par défaut           | Usage                                    |
|---------------------------------------|-----------------------------|------------------------------------------|
| `MESH_TX_VISIBILITY_POLICY`           | `acl`                       | Politique de visibilité des transactions |
| `MESH_BACKEND`                        | *(unset)*                   | Backend cible pour les tests             |
| `MESH_EVIDENCE_META_PATH`             | *(unset)*                   | Chemin artefacts evidence conformance    |
| `MESH_VITEST_STDIO`                   | `inherit`                   | `pipe` pour capturer stdout/stderr tests |
| `MESH_API_BASE_URL`                   | `http://127.0.0.1:8090`     | URL API (overridable par mode Vite)      |
| `MESH_SUBSCRIBE_BASE_URL`             | `http://127.0.0.1:8090`     | URL subscribe SSE                        |
| `MESH_TRANSPORT_PROXY_HOST`           | `127.0.0.1`                 | Host du proxy de fautes                  |
| `MESH_TRANSPORT_PROXY_PORT`           | `8091`                      | Port du proxy de fautes                  |
| `MESH_TRANSPORT_PROXY_UPSTREAM`       | `http://127.0.0.1:8090`     | Backend upstream du proxy                |
| `MESH_TRANSPORT_PROXY_CLOSE_DELAY_MS` | `200`                       | Délai avant fermeture stream proxy       |

### Ports locaux

| Service                          | Port  | Description                          |
|----------------------------------|-------|--------------------------------------|
| `mesh-graph-server`              | 8090  | Backend canonique                    |
| `mesh-transport-proxy`           | 8091  | Proxy de fautes SSE (dev/test only)  |
| `mesh-explorer-webapp` (dev)     | 5173  | Webapp → backend direct `:8090`      |
| `mesh-explorer-webapp` (proxy)   | 5174  | Webapp → subscribe via proxy `:8091` |

**Invariant réseau dev :**
- `:5173` → `:8090` direct (jamais via proxy)
- `:5174` → subscribe via `:8091`, API → `:8090`

---

## Commandes essentielles

```bash
# Démarrage lab complet (recommandé)
pnpm dev:lab

# Ou processus séparés
pnpm graph-server          # backend :8090
pnpm dev:transport-proxy   # proxy :8091
pnpm dev:web               # webapp :5173 (dev normal)
pnpm dev:web:proxy         # webapp :5174 (via proxy)
pnpm desktop               # desktop app

# Tests
pnpm test                  # build + conformance tests
pnpm test:all              # tous les tests
pnpm ci:conformance        # pipeline CI complet (build + test)

# Benchmarks
pnpm bench:cold-start
pnpm bench:perf-1
pnpm bench:replica-catchup
pnpm bench:snapshot-maintenance

# CI / validation
pnpm check:api-contract
pnpm check:reasoncodes-policy
pnpm check:public-exports-exist
pnpm ci:check-determinism
pnpm ci:validate-workflows

# Release
pnpm release:bump
pnpm release:changelog
pnpm release:artifacts
```

---

## Structure du monorepo

```
apps/
  mesh-app/                       # app principale
    src/
  mesh-explorer-desktop/          # desktop app
  mesh-explorer-webapp/           # webapp React
    src/
  mesh-graph-server/              # serveur graph HTTP
    src/
    test/
  mesh-notes/                     # app notes (référence)
  mesh-notes-replica/             # replica runtime ⚠ gap minimumCursor ouvert
    src/
  mesh-notes-server/              # serveur notes
    src/

packages/
  cli/                            # CLI mesh
    src/bin/
    test/
  conformance-harness/            # harness tests de conformance
    src/
  conformance-tests/              # suite tests conformance
    src/v2/sim/
    scripts/
  eventstore-local/               # EventStore local (IndexedDB/local)
    src/internal/
    test/
  force-graph/                    # moteur force-graph 2D
    src/
    test/
  kernel-minimal/                 # Kernel canonique minimal
    src/
    test/
  mesh-3d-force-graph-adapter/    # adaptateur 3d-force-graph
    src/
  mesh-explorer-ui/               # composants UI partagés
    src/devtools/
    src/ui/
    src/viewport/
    test/
  projection-minimal/             # moteur de projection
    src/
  runtime-local/                  # runtime local
    src/
    test/
    examples/
  shared/                         # types et utilitaires partagés
    src/
  snapshot-minimal/               # gestion snapshots
    src/
  sync-http/                      # sync via HTTP/SSE
    src/
  sync-local/                     # sync locale
    src/internal/

tools/
  ci/                             # scripts CI (api-contract, determinism...)
  mesh-transport-proxy/           # proxy de fautes SSE
    src/

scripts/
  bench/                          # benchmarks
  ci/                             # validation CI (lockfile, workflows...)
  migrations/                     # check storage version
  release/                        # bump, changelog, tag, artifacts
  packaging-smoke/

contracts/
  v1/golden/                      # contrats API golden files

specs/                            # spécifications du système
docs/
  audits/                         # audits de phases (ex: Audit_Phase_20.md)
  validation/

tests/
  e2e/                            # tests end-to-end

types/
  node/                           # types globaux Node
```

---

## Architecture — règles non négociables

### 1. Pipeline de mutation canonique

**Toute mutation passe exclusivement par :**
```
Intent → Command → Kernel → Transaction → EventStore
```
- Ne jamais écrire directement dans l'EventStore
- Ne jamais contourner le Kernel
- L'import lui-même passe par ce pipeline (pas d'écriture directe)

### 2. Séparation stricte des couches

| Couche      | Responsabilité                   | Jamais mutatrice de |
|-------------|----------------------------------|---------------------|
| Canon       | mutations, events, transactions  | —                   |
| Layout      | état UI local                    | Canon               |
| Caméra      | vue 3D                           | Canon               |
| Forces      | simulation physique graph        | Canon               |
| Projection  | vue dérivée (FS, etc.)           | Canon               |

- **Le Layout n'est jamais persisté dans le Canon**
- **La Projection n'est jamais mutatrice du Canon**

### 3. Modèle événementiel

- `EventEnvelope` : unité canonique de mémoire
- Streams : `meta` / `graph` — ordre intra-transaction : `meta → graph`
- Invariant **append-only** absolu
- Invariant **tx-closed** strict
- Replay **déterministe** obligatoire
- `txId` / `eventId` : unités d'idempotence et de déduplication

### 4. Plans d'adressage — ne jamais mélanger

```
graph | meta | overlay | derived | event
```

Adressage polymorphe : `EntityRef { graphSpace, kind, id }`

Règles absolues sur les IDs :
- Opaques, immuables, jamais recyclés
- Jamais interprétés par les consommateurs
- Unicité dans le `graphSpace`, pas globale
- `graphSpaceId` est la racine obligatoire de tous les stores et opérations

---

## Transport proxy — dev/test

### Démarrage

```bash
pnpm dev:lab    # tout en un (recommandé)
# ou séparément
pnpm dev:transport-proxy
```

### Contrôle du mode

```bash
# Via browser
http://127.0.0.1:8091/__test/transport/ui

# Via curl — lire l'état
curl http://127.0.0.1:8091/__test/transport/state

# Via curl — changer le mode
curl -X POST http://127.0.0.1:8091/__test/transport/mode \
  -H 'content-type: application/json' \
  -d '{"subscribeMode":"hang"}'
```

### Modes disponibles

| Mode    | Comportement                                      |
|---------|---------------------------------------------------|
| `pass`  | transparent, subscribe normal                     |
| `fail`  | refuse immédiatement la connexion subscribe       |
| `hang`  | accepte mais ne répond pas (timeout simulation)   |
| `close` | ferme le stream immédiatement                     |

Changer de mode **termine immédiatement** tout stream subscribe actif.
**Cet outil est dev/test only — ne jamais modifier la logique canonique avec lui.**

### Vérifier le routage en dev

Au démarrage webapp, console browser :
```
[mesh-explorer-webapp] dev routing  →  mode, apiBaseUrl, subscribeBaseUrl
```

---

## Sync Engine — invariants critiques Phase 20

| Invariant                                        | Statut           |
|--------------------------------------------------|------------------|
| Curseur strictement monotone                     | ✅ CONFIRMED      |
| Pas de régression cursor après restart           | ✅ CONFIRMED      |
| Duplicate delivery sans double transition d'état | ✅ CONFIRMED      |
| Fast-path bootstrap : préconditions complètes    | ✅ CONFIRMED      |
| Cache jamais autorité avant convergence          | ✅ CONFIRMED      |
| Snapshot/projection incompatibles → invalidation | ✅ CONFIRMED      |
| Bootstrap persistence cohérente (2-phase)        | ✅ CONFIRMED      |
| Evidence pipeline reproductible                  | ✅ CONFIRMED      |
| Transport masked ≡ absent (HTTP)                 | ⚠️ PARTIAL — P0   |
| Isolation principal stricte (HTTP layer)         | ⚠️ PARTIAL — P0   |

### P0 ouverts — bloquants pour Phase 21

1. **CT-HTTP-TRANSPORT-4 / CT-HTTP-RECOVERY-4** : indistinguabilité `masked` vs `absent` non tenue sur `sync:pull`, `sync:poll`, `events:read`, SSE.
2. **CT-HTTP-TRANSPORT-2** : séquence `pull` + `tx-closed` + filtrage principal incohérente.
3. **Gap `apps/mesh-notes-replica`** : `minimumCursor` ignoré au bootstrap.

**Phase 21 ne peut s'ouvrir que si ces trois P0 sont fermés.**

### Séquence bootstrap durable — ordre obligatoire en logs

```
DURABLE_PERSIST_STARTED
CACHE_WRITE_COMMITTED
CACHE_PERSISTED
DURABLE_PERSIST_SUCCEEDED
CURSOR_EXPOSED
```

---

## Conformance & CI

### Pipeline CI

```
install (filtered: @mesh/conformance-tests...)
→ ci:conformance:build
→ ci:conformance:test
→ invariant collection (expected-invariants.json)
→ posttest gate  ← CI fail si invariant attendu absent OU nouveau critique non enregistré
→ generate-evidence (artefacts MD + JSON reproductibles)
```

### Vitest avec env (run-vitest-with-env.mjs)

Injecte automatiquement `MESH_TX_VISIBILITY_POLICY=acl` si non défini.

En cas d'échec, logge : `cwd`, `node`, `vitestEntry`, `MESH_BACKEND`, `MESH_TX_VISIBILITY_POLICY`, `MESH_EVIDENCE_META_PATH`, `exitCode`, `signal`.

---

## Logs structurés — codes à connaître

```
# Bootstrap
BOOTSTRAP_DECISION
BOOTSTRAP_PERSIST_*
DURABLE_PERSIST_STARTED / SUCCEEDED
CACHE_WRITE_COMMITTED / CACHE_PERSISTED
CURSOR_EXPOSED

# Ghost guard / déduplication
GHOST_GUARD_DUPLICATE_IGNORED
GHOST_GUARD_EVENT_APPLIED
EVENT_APPLIED
DUPLICATE_IGNORED
CURSOR_ADVANCE

# Transport
TRANSPORT_DELTA_DECISION
TRANSPORT_DELTA_IGNORED
TRANSPORT_RESYNC_REQUIRED
TRANSPORT_DELTA_MISMATCH
POLL_SYNC_APPLIED
SYNC_CURSOR_ADVANCED
```

---

## Roadmap — état actuel

### En cours : fermeture Phase 20.x (~16 PR ciblées)

| Bloc                              | PRs  | Priorité |
|-----------------------------------|------|----------|
| Replica Runtime Harness           | 4–5  | P1       |
| Transport Duplicate Injection     | 3–4  | P1       |
| Subscribe Cursor Mismatch         | 3    | P1       |
| Sync Engine Torture Test          | 2–3  | P1       |
| Projection Ghost Edge Case        | 2    | P2       |
| SnapshotIndex Proof               | 1–2  | P2       |
| CLI maskPrincipals                | 1–2  | P2       |

**Principe absolu : 1 PR = 1 changement conceptuel.**
Ordre obligatoire : harness → chaos → torture test.

### Prochaine : Phase 21 (App minimale viable)

3D (`3d-force-graph`), contrat 2D/3D, recherche label, export/import JSON graph, projection FS read-only, undo/redo, persistance settings UI.

Critère de sortie : un utilisateur peut créer, relier, rechercher, exporter et explorer en 2D/3D.

---

## Règles de progression inter-phases

On ne passe pas à la phase suivante tant que :
1. les invariants du moteur sont stables
2. l'UX ne présente pas de glitch
3. les tests couvrent les flows critiques

---

## Ce que Claude NE doit PAS faire

- ❌ Écrire directement dans l'EventStore
- ❌ Muter le Canon depuis une Projection
- ❌ Persister le Layout dans le Canon
- ❌ Interpréter la forme d'un ID
- ❌ Mélanger les 5 plans d'adressage
- ❌ Ouvrir la Phase 21 sans fermer les P0 transport
- ❌ Implémenter plusieurs changements conceptuels dans une même PR
- ❌ Modifier la logique canonique via le transport proxy
- ❌ Router `:5173` à travers le proxy (`:5173` → `:8090` direct, toujours)
- ❌ Traiter ce projet comme une app UI standard

# Phase 17 Audit (post-merge) — Exiger des évidences (pas un résumé)

- Date (Europe/Paris) : 2026-02-17
- Contexte : Phase 17 post-merge audit (UI sync + bootstrap render + status lifecycle)
- Références : unknown
- Scope : packages/mesh-explorer-ui, apps/mesh-explorer-webapp, tests/e2e

## A) Bootstrap replay : déterminisme + fin de bootstrap

1) **Point d’entrée “Connect” + boucle bootstrap poll-replay**
- Le bouton `#connect` déclenche `connectAndSync(syncSession)` via `el.connect.onclick`.
- Un auto-connect existe aussi au mount (`syncSession += 1; void connectAndSync(syncSession);`).
- La boucle bootstrap est `pollReplayFromCursor` avec `while (activeSessionId === syncSession)`, appel `sync:poll`, application des events, update cursor, arrêt sur `(meta=0 && graph=0) || cursorUnchanged`.

2) **Fin de bootstrap => notification store même sans tx live**
- Après replay, le code exécute toujours `store.setCursor(...)` (fallback ou replayResult) avant de passer en poll-only.
- `setCursor` appelle `emit({ ...state, cursor })`.
- `emit` notifie tous les listeners (`for (const listener of listeners) listener(state)`).
- Test ciblé: `emits on cursor set to support bootstrap-only renders` vérifie qu’un `setCursor` déclenche bien l’émission (compteur `observed >= 3`).

3) **Déterminisme (mêmes polls => même état final)**
- `applyGraphEvents` n’utilise ni horloge, ni random, ni I/O; uniquement itération séquentielle des events et opérations map/set déterministes selon l’ordre d’entrée.
- L’état est reconstruit par copie (`new Map(state.nodesById)`, `new Map(state.linksById)`, `new Set(state.selectedNodeIds)`) puis remplacé via `emit` (pas de mutation de référence partagée).
- **Équivalent “bootstrapped”** : pas de flag explicite; la borne logique est le passage à `connectionStatus = "connected (poll-only)"` après replay+cursor persisté.

---

## B) Absence de double-application (poll vs SSE) + idempotence

1) **Stratégie actuelle**
- Pas de clé de dédup explicite (`eventId/metaSeq/graphSeq/txId`) dans le reducer/store.
- L’argument de sûreté est **idempotence structurelle partielle** :
  - `graph.node.created`/`graph.link.created` font `Map.set(id, payload)` => remplace à clé constante.
  - `deleted` font `Map.delete`.
  - `label.updated` écrase le label courant.
  => re-application d’un même event ne multiplie pas les entités visibles si ID identique.

2) **Preuves testées**
- Poll re-delivery: même lot appliqué 2 fois (`store.applyGraphEvents(graphEvents)` x2), puis `nodes.length === 2` (pas de duplication).
- Le même test valide matérialisation du lien unique après pull (`links.length === 1`).

3) **Ce qui manque / non prouvé**
- **Re-delivery SSE** non testé explicitement (pas de test qui réinjecte les mêmes `txBundles` SSE 2 fois).
- **Overlap poll/SSE** non testé explicitement (même event via poll puis SSE).

---

## C) Cursor : cohérence localStorage vs serveur

1) **Origine de `fromCursor` au Connect**
- `storageKey = mesh.cursor.{principal}.{graphSpaceId}`; lecture via `readCursor(storageKey)`.
- Fallback par défaut: `{ metaSeq: 0, graphSeq: 0 }`.
- Puis bootstrap démarre depuis ce `savedCursor` (`pollReplayFromCursor(savedCursor, sessionId)`).

2) **Quand le cursor persistant avance**
- Persist bootstrap: `persistCursor(storageKey, replayResult.cursor)` (ou fallback cursor).
- Persist SSE: sur `txBundles`, si `cursorFromBundles !== null`, setCursor + persist.
- **Important**: pas de garde “uniquement si events appliqués”. Le cursor peut être écrit même sans nouveaux events (ex: bootstrap cursor inchangé).

3) **Cas serveur**
- Cursor identique: accepté tel quel (`nextCursor = payload.cursorAfter ?? cursor`, puis set/persist), puis stop sur `cursorUnchanged`.
- Cursor en arrière: **aucune garde monotone** côté poll (`store.setCursor(nextCursor)` direct).
- Cursor divergent principal/graphSpace:
  - Côté client, isolation via clé localStorage inclut principal+graphSpaceId.
  - Mais pas de validation explicite de cohérence “serveur vs principal/graphSpace” dans payload.

---

## D) Immutabilité : mutation hors reducer / nouvelles références

1) **Chemin unique de mise à jour du GraphState**
- Les mutations de `GraphState` passent via méthodes store (`applyGraphEvents`, `setCursor`, sélection) qui finissent toutes sur `emit(next)`.

2) **Nouvelles références (pas mutation in-place de state courant)**
- `applyGraphEvents`: clone Map/Set avant modification, puis `emit({...state, ...})`.
- `toggleSelectNode`: clone `Set` avant add/delete puis emit.

3) **Scan mutation patterns**
- Commande exécutée: `rg -n "\.push\(|\.set\(|\.delete\(|\.add\(" packages/mesh-explorer-ui/src`
- Résultat: opérations mutantes détectées seulement sur clones locaux (ou collection listeners), pas sur références state partagées avant clone.

---

## E) Renderer : uniquement abonné au store (zéro dépendance SSE directe)

1) **Chemin rendu**
- Le rendu graphe (`graph2d.graphData(data)`) est dans `store.subscribe(...)`.
- Les handlers SSE appellent `store.applyGraphEvents(events)` + cursor/status, mais **pas** `graph2d.graphData` directement.

2) **Ordre d’initialisation**
- `setupRenderer()` puis `store.subscribe(...)` puis seulement après trigger de connexion (`connectAndSync`).

---

## F) Status lifecycle : source unique + transitions exactes

1) **États**
- Type union: `"disconnected" | "connecting" | "connected" | "connected (poll-only)" | "reconnecting"`.

2) **Source de vérité**
- Status n’est **pas** dans `GraphStore`; il vit dans variable locale `connectionStatus` + setter `setConnectionStatus`.
- Le DOM lit `connectionStatus` dans `renderStatus` (`el.status.textContent = connectionStatus`).

3) **Table transitions**
- Init mount -> `disconnected`.
- `connectAndSync` start -> `connecting`.
- Bootstrap fini -> `connected (poll-only)`.
- SSE stream ouvert (`response.body` OK) -> `connected`.
- SSE indisponible/erreur/fin de boucle -> `reconnecting`.
- Teardown DOM -> `disconnected`.

4) **Même store que cursor/lastSync ?**
- Cursor vient du store (`snapshot.cursor` / `store.getState().cursor`).
- Status vient d’une variable locale, **pas du store**.
- `lastSync` est aussi variable locale (`let lastSync = "n/a"`), donc pas store unique pour status/cursor/lastSync.

---

## G) Fragilités restantes / non-déterminisme (>=5)

1) **Pas de dédup explicite poll/SSE**
- Impact: re-delivery inter-canaux peut rejouer inutilement; généralement sans duplication visuelle si IDs stables, mais pas garanti pour tous types futurs.
- Mitigation existante: idempotence Map-by-id sur events actuels.

2) **Pas de garde monotone cursor (régression possible)**
- Impact: serveur bug/rollback peut faire reculer cursor local.
- Mitigation: aucune garde client observée (TODO Phase 18).

3) **`persistCursor` sans try/catch**
- Impact: exception localStorage (quota/private mode) peut casser flux.
- Mitigation partielle: `readCursor` est protégé; `persistCursor` ne l’est pas (TODO).

4) **Reentrancy connect: pas d’abort réseau**
- Impact: anciens fetch peuvent continuer; neutralisés partiellement par `sessionId !== syncSession`.
- Mitigation existante: garde session dans poll/SSE loops.

5) **Status hors store**
- Impact: split-brain potentiel (status/cursor/lastSync non atomiques).
- Mitigation: `renderStatus` recalc fréquent; pas de source unifiée (TODO).

6) **Fallback bootstrap “from 0” heuristique**
- Impact: peut masquer incohérences serveur/cursor en rechargeant complet.
- Mitigation: condition explicite seulement quand cursor persisté>0 + aucun event + store vide.

---

## Invariants validés après audit

- Le rendu graphe passe par `store.subscribe -> graphData`, pas par un call direct depuis SSE.
- Bootstrap poll-replay s’arrête sur condition explicite fin de flux/cursor stable.
- La fin de bootstrap provoque au moins une notification via `setCursor -> emit` (même sans tx live).
- `GraphState` est mis à jour avec nouvelles références Map/Set (pattern immutable local).
- Status lifecycle contient bien les 5 états demandés (type explicite).

---

## Ce qui n’est pas entièrement prouvé + preuve rapide à ajouter

- Re-delivery **SSE** explicite: manque un test qui rejoue deux fois le même `txBundles` dans le store.
- Overlap **poll/SSE** explicite: manque un test qui applique un event via poll puis via txBundles et vérifie cardinalité inchangée.
- Guard cursor monotone: manque test “cursor arrière” + assertion “ne pas persister si regressif”.
- Cohérence principal/graphSpace vs payload serveur: manque validation client et test d’isolation.

---

## Checks exécutés

- ✅ `rg -n "Connect|connect|bootstrap|applyGraphEvents|EventSource|SSE|subscribe|render|status|cursor|localStorage|fromCursor|onopen|onerror|dispatch|reducer|setState|emit" apps/mesh-explorer-webapp/src tests/e2e`
- ✅ `nl -ba packages/mesh-explorer-ui/src/index.ts | sed -n '90,260p'`
- ✅ `nl -ba packages/mesh-explorer-ui/src/index.ts | sed -n '260,680p'`
- ✅ `nl -ba packages/mesh-explorer-ui/src/graphStore.ts | sed -n '1,320p'`
- ✅ `nl -ba tests/e2e/mesh-explorer-ui-store.spec.ts | sed -n '1,220p'`
- ✅ `nl -ba tests/e2e/mesh-explorer-sync-materialization.spec.ts | sed -n '1,280p'`
- ✅ `rg -n "\\.push\\(|\\.set\\(|\\.delete\\(|\\.add\\(" packages/mesh-explorer-ui/src`
- ⚠️ `pnpm vitest run tests/e2e/mesh-explorer-ui-store.spec.ts tests/e2e/mesh-explorer-sync-materialization.spec.ts` (suite sync-materialization bloquée par résolution module `@mesh/sync-local/internal` dans cet environnement; le test store passe).

## Phase 18 — Backlog issu de l’audit (checklist)

- [ ] Ajouter un test explicite de re-delivery SSE qui rejoue deux fois le même `txBundles` et vérifie l’absence de duplication visible.
- [ ] Ajouter un test explicite d’overlap poll/SSE (même événement appliqué via poll puis SSE) avec assertion de cardinalité inchangée.
- [ ] Ajouter une garde monotone cursor + test de non-régression quand le serveur renvoie un cursor en arrière.
- [ ] Ajouter une validation de cohérence principal/graphSpace côté client + test d’isolation quand payload divergent.

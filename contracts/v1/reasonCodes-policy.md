# Politique de gestion des `reasonCode` (API Contract v1)

## 1) Définition: qu’est-ce qu’un `reasonCode` dans ce projet

Un `reasonCode` est un identifiant stable, orienté machine, utilisé dans les réponses API pour exprimer **la cause normalisée** d’un résultat non nominal (erreur, refus, impossibilité métier, garde-fou d’exécution, etc.).

Objectifs principaux:

- Permettre au client de brancher une logique déterministe (UX, retry, télémétrie) sans parser des messages texte.
- Servir de contrat public versionné entre producteurs et consommateurs API.
- Distinguer le **code stable** (`reasonCode`) du **message humain** (localisable, non contractuel).

### Format recommandé

- Chaîne en `UPPER_SNAKE_CASE`.
- ASCII `[A-Z0-9_]` uniquement.
- Préférer un vocabulaire métier explicite (`CANNOT_APPLY_LATER`) plutôt qu’ambigu (`INVALID_STATE_2`).
- Le `reasonCode` est unique dans le périmètre du contrat v1.

Exemple minimal de payload:

```json
{
  "ok": false,
  "reasonCode": "CANNOT_APPLY_LATER",
  "message": "Operation cannot be applied later in current state."
}
```

> `message` peut évoluer librement (ton, langue, précision) tant que le sens contractuel du `reasonCode` reste inchangé.

---

## 2) Règles de compatibilité SemVer pour `reasonCode`

Cette politique complète les règles SemVer de `contracts/v1`.

### Règle A — Ajout d’un `reasonCode` = **MINOR bump**

Ajouter un nouveau code est un changement additif: les clients existants continuont de fonctionner s’ils traitent les codes inconnus de manière défensive (fallback).

- Impact version: **minor**
- Action recommandée côté client: journaliser + fallback UX sur code inconnu.

### Règle B — Suppression ou renommage = **MAJOR bump**

Supprimer un code, ou le renommer (même si le sens est identique), casse les consommateurs qui matchent explicitement l’ancienne valeur.

- Impact version: **major**
- Migration: prévoir une note de migration explicite et une fenêtre de dépréciation quand possible.

### Règle C — Changement de sémantique d’un code existant = **MAJOR bump**

Si un code existant change de signification (même subtilement), les décisions côté client peuvent devenir incorrectes.

- Impact version: **major**
- Exemple de changement interdit en v1 sans major: faire passer `ALREADY_APPLIED` de “idempotent no-op” à “erreur bloquante”.

---

## 3) Exemples concrets

### Exemple 1 — Ajout d’un nouveau code `CANNOT_APPLY_LATER` (minor)

Cas: une nouvelle règle métier interdit désormais une application différée.

- Nouveau code ajouté: `CANNOT_APPLY_LATER`
- Les codes existants ne changent pas
- Bump version: **minor**

### Exemple 2 — Renommage d’un ancien code (major)

Cas: `NOT_ALLOWED_NOW` est renommé en `CANNOT_APPLY_LATER` sans alias public stable.

- Ancienne valeur supprimée / remplacée
- Clients qui attendent `NOT_ALLOWED_NOW` cassent
- Bump version: **major**

### Exemple 3 — Détail de la signification d’un code (documentation produit)

Cas: on clarifie en doc que `CANNOT_APPLY_LATER` couvre uniquement l’état `WINDOW_CLOSED` et pas `MISSING_PERMISSION`.

- Si c’est une **clarification fidèle** au comportement déjà en prod: patch documentaire possible (pas d’impact SemVer du contrat).
- Si cela modifie effectivement le comportement observable: considérer comme changement sémantique => **major**.

---

## 4) Procédure: mettre à jour politique + golden contract simultanément

Quand un `reasonCode` change, appliquer la séquence suivante dans la même PR:

1. **Décider le type de changement** (`minor` ou `major`) selon les règles ci-dessus.
2. **Modifier les sources de contrat** (types/export publics) qui exposent les `reasonCode`.
3. **Mettre à jour ce document** `contracts/v1/reasonCodes-policy.md`:
   - ajouter/modifier l’entrée concernée;
   - documenter si le code est nouveau, déprécié, aliasé ou supprimé.
4. **Régénérer les golden contracts**:
   - `pnpm api:contract:update`
5. **Vérifier l’absence d’écart non prévu**:
   - `pnpm check:api-contract`
6. **Valider la cohérence doc ↔ contrat** via les tests de lint proposés plus bas.
7. **Inclure dans la PR**:
   - justification du bump SemVer;
   - liste des `reasonCode` impactés;
   - stratégie client (fallback, migration, dépréciation).

Principe: **aucune évolution de `reasonCode` sans mise à jour conjointe du golden contract et de cette politique.**

---

## 5) Cas limites et conventions (aliases, dépréciation)

### Codes dépréciés

- Un code déprécié reste valide jusqu’au prochain major.
- Marquer explicitement l’état `deprecated` dans la documentation produit.
- Fournir le successeur recommandé (`replacedBy`) si applicable.

### Aliases

Les aliases publics (deux codes pour un même sens) sont possibles mais déconseillés car ils augmentent la complexité client.

Si un alias est nécessaire temporairement:

- Documenter `canonical` et `aliasOf`.
- Garantir que les deux valeurs restent supportées pendant la période annoncée.
- Supprimer l’alias uniquement lors d’un **major**.

### Gestion des codes inconnus côté client

Le contrat recommande un comportement défensif:

- ne pas planter sur un code inconnu;
- fallback vers une UX générique;
- tracer la valeur brute pour observabilité.

---

## 6) Suggestions de tests automatiques (sans dépendances externes)

Objectif: empêcher la dérive entre les `reasonCode` exposés et la documentation.

### Pattern A — Lint de format

Script Node.js (stdlib uniquement) qui vérifie:

- pattern `^[A-Z0-9_]+$`
- unicité des codes
- absence d’espace ou de tiret

Entrées possibles:

- union de littéraux dans `contracts/v1/golden/*.d.ts`
- ou liste centralisée maintenue à la main

### Pattern B — Lint doc ↔ contrat

1. Extraire la liste des codes depuis les golden `.d.ts`.
2. Extraire la liste des codes documentés (section dédiée, tableau ou bullets).
3. Échouer si:
   - un code du contrat n’est pas documenté;
   - un code documenté n’existe plus dans le contrat;
   - un code marqué `deprecated` n’a pas de stratégie claire (date cible major ou `replacedBy`).

### Pattern C — Contrôle du bump SemVer attendu

En CI, sur diff PR:

- Si ajout uniquement => exiger au moins **minor**.
- Si suppression, renommage, ou mutation sémantique signalée => exiger **major**.

Implémentation possible sans dépendances:

- comparer ancienne/nouvelle liste de codes (set diff) via script Node.js.
- lire la version cible depuis le manifest/version package.

### Pattern D — Test de robustesse client simulé

Tester un mini-consommateur de référence:

- reçoit un `reasonCode` inconnu;
- retourne un fallback déterministe;
- n’échoue pas en exception.

Ce test garantit la compatibilité ascendante pratique lors des ajouts mineurs.

---

## 7) Gouvernance pratique

- Gestion **manuelle et documentée** des `reasonCode` (pas de générateur automatique).
- Toute évolution doit être revue sous l’angle:
  - stabilité contrat,
  - impact client,
  - trajectoire de migration.
- En cas de doute sur la sémantique, traiter le changement comme potentiellement cassant et escalader vers **major**.

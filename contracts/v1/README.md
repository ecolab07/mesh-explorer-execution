# API Contract v1

Cette arborescence fige la surface **Public API v1** consommable par une application.

## Packages Public API v1

La liste canonique est définie dans `contracts/v1/manifest.json` :

- `@mesh/shared` (types, reasonCodes, cursor/receipt primitives)
- `@mesh/kernel-minimal` (contrat d'exécution minimal)
- `@mesh/sync-local` (sync receipts côté app)

## Règles SemVer

- **Pas de diff** entre `generated` et `golden` : pas de changement d'API publique.
- **Diff additive compatible** (nouveaux exports/types non cassants) : bump **minor**.
- **Diff cassante** (suppression/changement incompatible de signatures/types) : bump **major**.

## Commandes

- Mettre à jour les golden files (après décision de versioning):
  - `pnpm api:contract:update`
- Script utilisé: `tools/ci/update-api-contract.mjs`
  - lit `contracts/v1/manifest.json`
  - régénère les `.d.ts` des packages `kind: "public"`
  - normalise le contenu (timestamps/chemins absolus/en-têtes variables)
  - écrase `contracts/v1/golden/*.d.ts`
  - affiche la liste des fichiers écrasés
- Vérifier la compatibilité (bloquant CI):
  - `pnpm check:api-contract`

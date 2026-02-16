# Versioning Policy

## 1) Version scheme

- Mesh Explorer uses semver with phase-aligned minor versions: `0.<phase>.<patch>`.
- Example: `0.18.0` for the initial Phase 18 release.

## 2) Release discipline in `0.x`

Mandatory blocking gates before tagging:

- `pnpm -r build`
- `pnpm check:api-contract`
- `pnpm test`
- `pnpm --filter @mesh/conformance-tests check:critical`
- `pnpm check:packaging`

## 3) Breaking behavior policy

- Any behavior change affecting security/visibility semantics (`allow|deny|mask`, principal filtering, tx-wide masking) is treated as breaking behavior.
- In `0.x`, such changes must be explicitly labeled in changelog/release notes even if shipped under minor progression.

## 4) Release automation commands

- `pnpm release:bump <version>`
- `pnpm release:changelog <version> --date YYYY-MM-DD`
- `pnpm release:artifacts <version>`
- `pnpm release:tag <version>`

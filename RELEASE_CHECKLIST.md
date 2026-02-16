# RELEASE_CHECKLIST

## Blocking gates

- Run `pnpm -r build`.
- Run `pnpm check:api-contract`.
- Run `pnpm test`.
- Run conformance tests (`pnpm --filter @mesh/conformance-tests test`).
- Run critical gate (`pnpm --filter @mesh/conformance-tests check:critical`).
- Run `pnpm check:packaging`.
- Run artifacts hygiene gate (`pnpm --filter @mesh/conformance-tests check:artifacts-clean`).
- Verify release docs/scripts execute as written (`RELEASE_WORKFLOW.md`).

## Informational (non-blocking)

- Run `pnpm bench:perf-1` (baseline perf trend only).
- Run `pnpm bench:compare` (backend trend only, if applicable).
- Run `pnpm bench:nightly` locally for preview (regression fail mode is reserved for scheduled CI).

## Release prep

- Validate documentation sanity: `SUPPORT_MATRIX.md`, `KNOWN_LIMITATIONS.md`, and security posture remain accurate.
- Apply version bump, update changelog, create tag, and build release artifacts.
- Confirm no Mesh public API v1 changes were introduced.

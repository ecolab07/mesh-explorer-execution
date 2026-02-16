# RELEASE_CHECKLIST

## Blocking gates

- Run `pnpm -r build`.
- Run `pnpm check:api-contract`.
- Run `pnpm test`.
- Run conformance tests (`pnpm --filter @mesh/conformance-tests test`).
- Run critical gate (`pnpm --filter @mesh/conformance-tests check:critical`).
- Run `pnpm check:packaging`.
- Run artifacts hygiene gate (`pnpm --filter @mesh/conformance-tests check:artifacts-clean`).

## Informational (non-blocking)

- Run `pnpm bench:perf-1` (record JSON output in release notes).
- Run `pnpm bench:compare` (capture backend comparison output for internal tracking when applicable).

## Release prep

- Validate documentation sanity: `SUPPORT_MATRIX.md`, `KNOWN_LIMITATIONS.md`, and current security status are still accurate.
- Apply version bump, create tag, and update changelog/release notes.

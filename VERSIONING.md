# Versioning Policy

## 1) Version scheme

- Mesh Explorer versions track internal delivery phases.
- Phase-aligned releases use the `0.<phase>.<patch>` pattern (example: `0.16.x` for Phase 16 updates).

## 2) 0.x discipline

For every release in `0.x`, the following gates are mandatory:

- API contract check is required (`pnpm check:api-contract`).
- Conformance critical gate is required.
- Packaging check is required (`pnpm check:packaging`).

## 3) Breaking behavior policy

- Activation/enforcement of security (`allow|deny|mask`, principal filtering, tx-wide masking) changes observable behavior and is treated as a breaking change.
- In `0.x`, breaking behavior may still ship under minor/phase progression, but MUST be explicitly labeled as breaking behavior in release notes/changelog.

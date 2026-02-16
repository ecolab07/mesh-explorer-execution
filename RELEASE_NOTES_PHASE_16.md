# Release Notes — Phase 16 (Internal)

## What shipped in Phase 16

Phase 16 closes Product Stabilization (Pass 1) for v1 operational discipline:

- packaging validation and external-consumer smoke confidence,
- explicit support/operational/limitations documentation,
- release gate checklist normalization,
- performance guardrails captured as informational evidence,
- artifact hygiene gate (`check:artifacts-clean`) integrated for release evidence cleanliness.

## Operational guarantees

Operational guarantees remain centered on deterministic local execution semantics (append-only behavior, tx-closed reads, idempotent commit handling, deterministic replay) with security enforcement active when policy is enabled and principal context is provided.

## Known limitations

Known limitations remain unchanged for v1 scope: single-writer model, no distributed sync runtime guarantees, experimental IndexedDB backend posture, and no performance-optimization promise beyond current guardrails. Snapshot compaction maintenance occurs at startup and snapshots remain non-canonical cache artifacts.

## Upgrade / compatibility notes

- No public API v1 changes in this closeout.
- Runtime/package posture remains ESM-only.
- Node.js support baseline remains Node 18+.
- IndexedDB support remains Experimental/Beta (non-default posture).

## What’s next

Subsequent phases continue hardening and extension work beyond Pass 1 stabilization (including deeper perf and readiness tracks) without changing the Phase 16 compatibility baseline in this closeout.

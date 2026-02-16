# Remote Readiness (Spec-Ready, Not Implemented)

## 1) Scope

This document defines the required conditions to enable a Remote / Sync backend in Mesh Explorer.

It does **not** describe a feature that is implemented today.

## 2) Required invariants (Remote MUST)

A Remote backend MUST preserve all execution invariants already enforced by local/conformance behavior:

- Append-only logical history.
- Strict tx-closed visibility (`commit-or-nothing`).
- Total order per stream (meta stream and graph stream).
- Deterministic replay outcomes.
- Persistent idempotency keyed by `(actor, idempotencyKey)`.
- Tx-closed read ranges (pagination MUST NOT expose partial transactions).
- No user-safe exposure without security filtering (masking MUST be non-leaking).

## 3) Conformance gates before enabling Remote (MUST PASS)

Before any Remote backend can be enabled, the following conformance gates MUST pass:

- Append-only immutability test suite.
- Tx-closed range/pagination test suite.
- Replay equivalence tests (full replay vs snapshot+replay when snapshots exist).
- Strict idempotency persistence tests.
- If security is active:
  - mask indistinguishability tests,
  - principal-filtered cursor/range tests.

## 4) v1 Non-goals (explicit)

- No merge semantics.
- No multi-writer coordination.
- No distributed locking.
- No "live collaborative sync" claims/marketing.

## 5) Local implementation status

- `runtime-local` is a structural reference implementation.
- Local backend is used as a reference for conformance testing (harness), not as a canonical oracle.
- Equivalence is defined by invariants + normalized outputs, not by matching local implementation details.

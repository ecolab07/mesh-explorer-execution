# Conformance Evidence (Critical)

- Vitest: ^2.1.8
- Suites: CT-C-* Cursor semantics per principal, CT-P-* Projection determinism

## Invariant Coverage
| InvariantID | Surface | Test(s) | Oracle | Criticality | Preconditions / Setup | Limitations connues |
|---|---|---|---|---|---|---|
| CT-K-2 | Kernel | packages/conformance-tests/src/ct_k_semantics.test.ts::[INV:CT-K-2][SURF:Kernel] CT-K-2: idempotent resubmission with same key returns same receipt | Replaying same actorId+idempotencyKey+payload returns the exact original committed receipt. | Critical | const kernel = new KernelMinimalImpl(store); const first = await kernel.execute({ |  |
| CT-K-3 | Kernel | packages/conformance-tests/src/ct_k_semantics.test.ts::[INV:CT-K-3][SURF:Kernel] CT-K-3: idempotency key reuse with payload mismatch is rejected | Reusing idempotency key with different payload must reject with CONFLICT/IDEMPOTENCY_PAYLOAD_MISMATCH. | Critical | const kernel = new KernelMinimalImpl(store); const accepted = await kernel.execute({ |  |
| CT-K-4 | Kernel | packages/conformance-tests/src/ct_k_semantics.test.ts::[INV:CT-K-4][SURF:Kernel] CT-K-4: commit invariants preserve appendTx + base revision preconditions | Append-layer precondition failures must be propagated as PRECONDITION/REVISION_MISMATCH. | Critical | const fakeStore = new RevisionMismatchStore(); const kernel = new KernelMinimalImpl(fakeStore) |  |
| CT-L-1 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-1][SURF:EventStore] CT-L-1 Append-only immutability (Critical) | Appended transaction envelopes are immutable in canonical form across repeated reads. | Critical | const store = scope.store; const graphSpaceId = "space-l1" |  |
| CT-L-2 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-2][SURF:EventStore] CT-L-2 tx-closed readRange extension (Critical) | Extending read ranges preserves tx-closed boundaries and stable event ordering. | Critical | const store = scope.store; const graphSpaceId = "space-l2" |  |
| CT-L-3 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-3][SURF:EventStore] CT-L-3 tx_index monotonicity and two-stream ordering (Critical) | txIndex increases monotonically and stream sequence ordering stays consistent across tx boundaries. | Critical | const store = scope.store; const graphSpaceId = "space-l3" |  |
| CT-L-4 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-4][SURF:EventStore] CT-L-4 Tx boundary integrity + idempotence (Critical) | A transaction is atomically persisted once and idempotent replay returns the original committed receipt. | Critical | const store = scope.store; const graphSpaceId = "space-l4" |  |
| CT-L-5 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-5][SURF:EventStore] CT-L-5 Fault Injection: crash before commit keeps store atomic | Crash before commit must leave no partial transaction state (neither events nor idempotency entry). | Critical | const store = scope.store; const graphSpaceId = "space-l5" |  |
| CT-L-7 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-7][SURF:EventStore] CT-L-7 restart realism: persisted tx survives reopen + idempotence (Critical) | After restart, committed tx remains readable and idempotent replay returns original receipt without duplication. | Critical | const graphSpaceId = "space-l7"; const txBundle = { txId: "tx-restart", metaEvents: [{ m: 1 }], graphEvents: [{ g: 1 }] } |  |
| CT-L-8 | EventStore | packages/conformance-tests/src/ct_l_core.test.ts::[INV:CT-L-8][SURF:EventStore] CT-L-8 restart realism: crash+restart around CT-L-5 keeps final state atomic (Critical) | Crash before commit then restart keeps store atomic: no partial tx survives and clean retry commits once. | Critical | const graphSpaceId = "space-l8"; const tx = { txId: "tx-l8", metaEvents: [{ m: "m" }], graphEvents: [{ g: "g" }] } |  |
| CT-S-1 | Security | packages/conformance-tests/src/ct_s_security.test.ts::[INV:CT-S-1][SURF:Security] CT-S-1: absent and masked tx are indistinguishable | Masked and absent transaction reads must return identical normalized NOT_FOUND_OR_MASKED rejections. | Critical | const graphSpaceId = "space-s1"; await store.appendTx( |  |
| CT-S-2 | Security | packages/conformance-tests/src/ct_s_security.test.ts::[INV:CT-S-2][SURF:Security] CT-S-2: masked event hides full transaction without observable holes | Masked event visibility removes entire transaction from principal range without cursor holes. | Critical | const graphSpaceId = "space-s2"; await store.appendTx( |  |
| CT-SYNC-3 | Sync | packages/conformance-tests/src/ct_sync_harness.test.ts::[INV:CT-SYNC-3][SURF:Sync] CT-SYNC-3: end-to-end submit -> poll -> receipt -> replay | submit->poll->receipt->replay remain coherent: committed tx is seen once then replay is empty. | Critical | const graphSpaceId = "space-sync3"; const harness = new LocalSyncHarness(store, graphSpaceId) |  |

## Criticality summary
- Critical: 13
- Structural: 0
- Regression: 0
- Critical IDs: CT-K-2, CT-K-3, CT-K-4, CT-L-1, CT-L-2, CT-L-3, CT-L-4, CT-L-5, CT-L-7, CT-L-8, CT-S-1, CT-S-2, CT-SYNC-3

## Coverage gaps
Coverage gaps: none.

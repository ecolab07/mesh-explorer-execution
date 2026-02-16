# KNOWN_LIMITATIONS

## 1) Implementation limitations (current)

- Local EventStore implementations are conformance-oriented and not performance-optimized; some read paths perform repeated filtering/scans and can degrade toward costly O(N²)-like behavior on large histories.
- Projection snapshots now compact payload coverage during startup maintenance (`start()`) and store bounded coverage metadata instead of unbounded `txIds`; growth risk is mitigated but snapshots remain non-canonical/reconstructible cache artifacts.
- Remote backend is not implemented.
- No real distributed sync mechanism is active; current sync scope is local harness behavior only (no networked runtime sync guarantees).
- Single-writer assumption applies; multi-writer operation is not supported.
- Performance guardrails are not blocking gates in this Pass 1 scope (not included yet as enforced release criteria).

### IndexedDB limitations

- IndexedDB backend is Experimental / Beta.
- Large-scale performance has not been benchmarked yet.
- Multi-tab and cross-process coordination guarantees are not established.
- Compaction strategy and backend-specific tuning are not yet optimized.
- Browser crash-recovery behavior has not been stress-tested.

## 2) Architecture-level v1 constraints (by design)

- No concurrent merge semantics.
- No automatic overlay rebase semantics.
- No global total order across `meta` and `graph` streams.
- No offline optimistic commit protocol.
- Snapshots are non-canonical and never source of truth.
- Projection output is a derived view and not ontological truth.

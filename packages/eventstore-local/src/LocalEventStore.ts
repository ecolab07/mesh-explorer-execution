import type {
  CommandError,
  Cursor,
  EventEnvelope,
  FaultInjectionHooks,
  GraphSpaceId,
  IdempotencyCtx,
  ReadRangeOptions,
  ReadMode,
  StreamName,
  TransactionReceipt,
  TxIndexEntry,
  TxBundle,
  TxId
} from "@mesh/shared";

/** spec-ref: Mesh_Execution_Compiled_v_1.md §11.4 (exact normative signature) */
export interface LocalEventStore {
  appendTx(
    graphSpaceId: GraphSpaceId,
    txBundle: TxBundle,
    idempotencyCtx: IdempotencyCtx,
    hooks?: FaultInjectionHooks
  ): Promise<TransactionReceipt | CommandError>;

  readTx(graphSpaceId: GraphSpaceId, txId: TxId): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | null>;

  readRange(
    graphSpaceId: GraphSpaceId,
    stream: StreamName,
    fromSeqExclusive: number,
    limit: number,
    mode: ReadMode,
    options?: ReadRangeOptions
  ): Promise<EventEnvelope[]>;

  readTxIndex(graphSpaceId: GraphSpaceId): Promise<TxIndexEntry[]>;

  getCursorHead(graphSpaceId: GraphSpaceId): Promise<Cursor>;

  resolveRevision(graphSpaceId: GraphSpaceId, revisionToken: string): Promise<Cursor | null>;
}

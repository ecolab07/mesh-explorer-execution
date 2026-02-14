import type {
  CommandError,
  Cursor,
  EventEnvelope,
  FaultInjectionHooks,
  GraphSpaceId,
  IdempotencyCtx,
  PrincipalContext,
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

  readTxForPrincipal(
    graphSpaceId: GraphSpaceId,
    txId: TxId,
    principal?: PrincipalContext
  ): Promise<{ txId: TxId; meta: EventEnvelope[]; graph: EventEnvelope[] } | CommandError>;

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

  readPrincipalTxRange(
    graphSpaceId: GraphSpaceId,
    fromPrincipalCursorExclusive: number,
    limit: number,
    principal?: PrincipalContext
  ): Promise<{ txs: Array<{ txId: TxId; txIndex: number; meta: EventEnvelope[]; graph: EventEnvelope[] }>; cursor: number }>;

  getPrincipalCursorHead(graphSpaceId: GraphSpaceId, principal?: PrincipalContext): Promise<number>;

  resolveRevision(graphSpaceId: GraphSpaceId, revisionToken: string): Promise<Cursor | null>;
}

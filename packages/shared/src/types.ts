/** spec-ref: Mesh_Execution_Compiled_v_1.md §11.1-11.2, §11.4 */
export type GraphSpaceId = string;
export type TxId = string;
export type EventId = string;
export type ActorId = string;
export type IdempotencyKey = string;
export type PayloadHash = string;

export type StreamName = "meta" | "graph";

export interface Cursor {
  metaSeq: number;
  graphSeq: number;
}

export interface EventRef {
  stream: StreamName;
  seq: number;
  eventId: EventId;
}

export type CanonicalEventPayload = Record<string, unknown>;

export interface TxBundle {
  txId: TxId;
  metaEvents: CanonicalEventPayload[];
  graphEvents: CanonicalEventPayload[];
}

export interface EventEnvelope {
  graphSpaceId: GraphSpaceId;
  stream: StreamName;
  seq: number;
  txId: TxId;
  eventId: EventId;
  payload: CanonicalEventPayload;
  createdAt?: string;
}

export interface Command {
  graphSpaceId: GraphSpaceId;
  commandId: string;
  actorId: ActorId;
  idempotencyKey: IdempotencyKey;
  payload: Record<string, unknown>;
  requireBaseRevision?: string;
}

export interface TransactionReceipt {
  status: "committed";
  commandId: string;
  txId: TxId;
  cursorAfter: Cursor;
  eventRefs: {
    meta: EventRef[];
    graph: EventRef[];
  };
}

export type CommandErrorCategory =
  | "VALIDATION"
  | "PERMISSION"
  | "CONFLICT"
  | "PRECONDITION"
  | "NOT_FOUND"
  | "INTERNAL";

export interface CommandError {
  status: "rejected" | "error";
  commandId?: string;
  category: CommandErrorCategory;
  reasonCode: string;
  masked?: boolean;
  retryable?: boolean;
}

export type CommandOutcome = TransactionReceipt | CommandError;

export type ReadMode = "TX_CLOSED";

export interface IdempotencyCtx {
  actorId: ActorId;
  idempotencyKey: IdempotencyKey;
  payloadHash: PayloadHash;
}

export type FaultPoint =
  | "BEFORE_ANY_WRITE"
  | "AFTER_META_EVENTS"
  | "AFTER_GRAPH_EVENTS"
  | "AFTER_TX_INDEX"
  | "AFTER_HEADS_UPDATE"
  | "AFTER_IDEMPOTENCY_UPSERT"
  | "BEFORE_IDB_COMMIT";

export interface FaultInjectionHooks {
  failAt?: FaultPoint;
  onPoint?: (p: FaultPoint) => void;
}

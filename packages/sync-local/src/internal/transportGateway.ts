import type { LocalEventStore } from "@mesh/eventstore-local";
import {
  canonicalString,
  type Command,
  type CommandOutcome,
  type Cursor,
  type EventEnvelope,
  type PrincipalContext,
  type StreamName,
  type TxBundle
} from "@mesh/shared";

export interface TransportAck {
  accepted: true;
  acceptedAt: string;
  idempotencyKey: string;
}

export interface SubmitResult {
  ackTransport: TransportAck;
  final: Promise<CommandOutcome>;
}

export interface SyncPullOptions {
  limitTx?: number;
  limitBytes?: number;
}

export interface EventsReadOptions {
  limitEvents?: number;
  limitBytes?: number;
}

export interface SyncPollOptions {
  metaLimitEvents?: number;
  metaLimitBytes?: number;
  graphLimitEvents?: number;
  graphLimitBytes?: number;
}

export interface SyncPollResultV1 {
  meta: EventEnvelope[];
  graph: EventEnvelope[];
  cursorAfter: Cursor;
}

export interface VisibleTxBundle {
  principalCursor: number;
  txBundle: TxBundle;
}

export interface SyncPullResult {
  txBundlesVisible: VisibleTxBundle[];
  cursorAfterVisible: number;
}

export interface SyncFrameTxBundles {
  kind: "txBundles";
  txBundlesVisible: VisibleTxBundle[];
}

export interface SyncFrameHeartbeat {
  kind: "heartbeat";
  cursorVisible: number;
}

export interface SyncFrameCursor {
  kind: "cursor";
  cursorVisible: number;
}

export type SyncFrame = SyncFrameTxBundles | SyncFrameHeartbeat | SyncFrameCursor;

export interface SyncSubscribeOptions extends SyncPullOptions {
  pollIntervalMs?: number;
  heartbeatEveryMs?: number;
}

export interface LocalSyncGatewayConfig {
  graphSpaceId: string;
  executeCommand?: (command: Command) => Promise<CommandOutcome>;
}

const DEFAULT_LIMIT_TX = 64;
const DEFAULT_LIMIT_BYTES = 128 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 15;
export const HEARTBEAT_INTERVAL_MS = Number(
  process.env.MESH_HEARTBEAT_INTERVAL_MS ?? 5000
);
const utf8Encoder = new TextEncoder();
const DEBUG_SYNC_ENABLED = process.env.MESH_DEBUG_SYNC === "1";

export class LocalSyncGateway {
  constructor(
    private readonly eventStore: LocalEventStore,
    private readonly config: LocalSyncGatewayConfig
  ) {}

  submit(graphSpaceId: string, principal: PrincipalContext, command: Command, idempotencyKey?: string): SubmitResult {
    this.assertGraphSpaceScope(graphSpaceId);
    void principal;

    const stableKey = idempotencyKey ?? command.idempotencyKey;
    const commandWithStableKey: Command = {
      ...command,
      graphSpaceId,
      idempotencyKey: stableKey
    };

    const final = this.config.executeCommand
      ? this.config.executeCommand(commandWithStableKey)
      : Promise.resolve<CommandOutcome>({
          status: "error",
          category: "INTERNAL",
          reasonCode: "TRANSPORT.SUBMIT.NOT_CONFIGURED",
          commandId: command.commandId
        });

    return {
      ackTransport: {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        idempotencyKey: stableKey
      },
      final
    };
  }

  async syncPull(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options: SyncPullOptions = {}
  ): Promise<SyncPullResult> {
    this.assertGraphSpaceScope(graphSpaceId);

    const limitTx = Math.max(1, options.limitTx ?? DEFAULT_LIMIT_TX);
    const limitBytes = Math.max(1, options.limitBytes ?? DEFAULT_LIMIT_BYTES);

    const { txs } = await this.eventStore.readPrincipalTxRange(graphSpaceId, fromCursorVisible, limitTx, principal);

    const txBundlesVisible: VisibleTxBundle[] = [];
    let consumedBytes = 0;
    let cursor = fromCursorVisible;

    for (let idx = 0; idx < txs.length; idx += 1) {
      const tx = txs[idx]!;
      const nextBundle: VisibleTxBundle = {
        principalCursor: fromCursorVisible + idx + 1,
        txBundle: {
          txId: tx.txId,
          metaEvents: tx.meta.map((event) => event.payload),
          graphEvents: tx.graph.map((event) => event.payload)
        }
      };

      const size = utf8Encoder.encode(canonicalString(nextBundle.txBundle)).length;
      if (txBundlesVisible.length > 0 && consumedBytes + size > limitBytes) {
        break;
      }

      txBundlesVisible.push(nextBundle);
      consumedBytes += size;
      cursor = nextBundle.principalCursor;

      await Promise.resolve();
    }

    return {
      txBundlesVisible,
      cursorAfterVisible: cursor
    };
  }

  async *syncSubscribe(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options: SyncSubscribeOptions = {}
  ): AsyncIterable<SyncFrame> {
    this.assertGraphSpaceScope(graphSpaceId);
    debugSync("sync:subscribe:start", {
      graphSpaceId,
      principalId: principal.principalId,
      fromCursorVisible
    });

    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const heartbeatEveryMs = Math.max(pollIntervalMs, options.heartbeatEveryMs ?? HEARTBEAT_INTERVAL_MS);

    let cursor = fromCursorVisible;
    let lastHeartbeatAt = Date.now();

    while (true) {
      const pulled = await this.syncPull(graphSpaceId, principal, cursor, options);
      if (pulled.txBundlesVisible.length > 0) {
        debugSync("sync:subscribe:txBundles", {
          graphSpaceId,
          principalId: principal.principalId,
          cursorBefore: cursor,
          txBundlesVisibleCount: pulled.txBundlesVisible.length,
          cursorAfterVisible: pulled.cursorAfterVisible
        });
        yield {
          kind: "txBundles",
          txBundlesVisible: pulled.txBundlesVisible
        };
        cursor = pulled.cursorAfterVisible;
        yield {
          kind: "cursor",
          cursorVisible: cursor
        };
        continue;
      }

      const now = Date.now();
      if (now - lastHeartbeatAt >= heartbeatEveryMs) {
        debugSync("sync:subscribe:heartbeat", {
          graphSpaceId,
          principalId: principal.principalId,
          cursorVisible: cursor
        });
        yield {
          kind: "heartbeat",
          cursorVisible: cursor
        };
        lastHeartbeatAt = now;
      }

      await sleep(pollIntervalMs);
    }
  }

  async eventsRead(
    graphSpaceId: string,
    principal: PrincipalContext,
    stream: StreamName,
    fromSeqExclusive: number,
    options: EventsReadOptions = {}
  ): Promise<EventEnvelope[]> {
    this.assertGraphSpaceScope(graphSpaceId);

    const limitEvents = Math.max(1, options.limitEvents ?? DEFAULT_LIMIT_TX);
    const limitBytes = Math.max(1, options.limitBytes ?? DEFAULT_LIMIT_BYTES);
    const visible = await this.readVisiblePrincipalEvents(graphSpaceId, principal);
    const byStream = stream === "meta" ? visible.meta : visible.graph;
    const candidate = byStream.filter((event) => event.seq > Math.max(0, fromSeqExclusive));

    const output: EventEnvelope[] = [];
    let consumedBytes = 0;
    let index = 0;
    while (index < candidate.length) {
      const txId = candidate[index]!.txId;
      let end = index + 1;
      while (end < candidate.length && candidate[end]!.txId === txId) {
        end += 1;
      }
      const txSlice = candidate.slice(index, end);
      const txSize = utf8Encoder.encode(canonicalString(txSlice)).length;
      if (output.length > 0 && (output.length + txSlice.length > limitEvents || consumedBytes + txSize > limitBytes)) {
        break;
      }
      output.push(...txSlice);
      consumedBytes += txSize;
      index = end;
    }

    return output;
  }

  async syncPoll(
    graphSpaceId: string,
    principal: PrincipalContext,
    cursor: Cursor,
    options: SyncPollOptions = {}
  ): Promise<SyncPollResultV1> {
    this.assertGraphSpaceScope(graphSpaceId);

    const metaLimitEvents = Math.max(0, options.metaLimitEvents ?? DEFAULT_LIMIT_TX);
    const graphLimitEvents = Math.max(0, options.graphLimitEvents ?? DEFAULT_LIMIT_TX);
    const metaLimitBytes = Math.max(1, options.metaLimitBytes ?? DEFAULT_LIMIT_BYTES);
    const graphLimitBytes = Math.max(1, options.graphLimitBytes ?? DEFAULT_LIMIT_BYTES);

    const { txs } = await this.eventStore.readPrincipalTxRange(graphSpaceId, 0, Number.MAX_SAFE_INTEGER, principal);

    const meta: EventEnvelope[] = [];
    const graph: EventEnvelope[] = [];
    let consumedMetaBytes = 0;
    let consumedGraphBytes = 0;
    let metaSeq = 0;
    let graphSeq = 0;

    for (const tx of txs) {
      const txMeta = tx.meta.map((event) => {
        metaSeq += 1;
        return { ...event, seq: metaSeq };
      });
      const txGraph = tx.graph.map((event) => {
        graphSeq += 1;
        return { ...event, seq: graphSeq };
      });

      const hasMeta = txMeta.length > 0;
      const hasGraph = txGraph.length > 0;
      const wantsMeta = hasMeta && txMeta[txMeta.length - 1]!.seq > cursor.metaSeq;
      const wantsGraph = hasGraph && txGraph[txGraph.length - 1]!.seq > cursor.graphSeq;

      if (!wantsMeta && !wantsGraph) {
        continue;
      }

      if ((wantsMeta && hasGraph && !wantsGraph) || (wantsGraph && hasMeta && !wantsMeta)) {
        break;
      }

      const txMetaBytes = txMeta.length > 0 ? utf8Encoder.encode(canonicalString(txMeta)).length : 0;
      const txGraphBytes = txGraph.length > 0 ? utf8Encoder.encode(canonicalString(txGraph)).length : 0;

      const nextMetaCount = meta.length + txMeta.length;
      const nextGraphCount = graph.length + txGraph.length;
      const exceedsMetaEvents = nextMetaCount > metaLimitEvents;
      const exceedsGraphEvents = nextGraphCount > graphLimitEvents;
      const exceedsMetaBytes = consumedMetaBytes + txMetaBytes > metaLimitBytes;
      const exceedsGraphBytes = consumedGraphBytes + txGraphBytes > graphLimitBytes;
      const isFirstOutput = meta.length === 0 && graph.length === 0;

      const cannotEmitBecauseZeroLimit =
        (metaLimitEvents === 0 && txMeta.length > 0) ||
        (graphLimitEvents === 0 && txGraph.length > 0);

      if (
        cannotEmitBecauseZeroLimit ||
        (!isFirstOutput && (exceedsMetaEvents || exceedsGraphEvents || exceedsMetaBytes || exceedsGraphBytes))
      ) {
        break;
      }

      meta.push(...txMeta);
      graph.push(...txGraph);
      consumedMetaBytes += txMetaBytes;
      consumedGraphBytes += txGraphBytes;
    }

    const result = {
      meta,
      graph,
      cursorAfter: {
        metaSeq: meta[meta.length - 1]?.seq ?? cursor.metaSeq,
        graphSeq: graph[graph.length - 1]?.seq ?? cursor.graphSeq
      }
    };

    debugSync("sync:poll", {
      graphSpaceId,
      principalId: principal.principalId,
      cursor,
      cursorAfter: result.cursorAfter,
      metaCount: result.meta.length,
      graphCount: result.graph.length,
      options
    });

    return result;
  }

  private assertGraphSpaceScope(graphSpaceId: string): void {
    if (graphSpaceId !== this.config.graphSpaceId) {
      throw new Error("Transport graphSpace mismatch");
    }
  }

  private async readVisiblePrincipalEvents(
    graphSpaceId: string,
    principal: PrincipalContext
  ): Promise<{ meta: EventEnvelope[]; graph: EventEnvelope[] }> {
    const { txs } = await this.eventStore.readPrincipalTxRange(graphSpaceId, 0, Number.MAX_SAFE_INTEGER, principal);

    let metaSeq = 0;
    let graphSeq = 0;
    const meta: EventEnvelope[] = [];
    const graph: EventEnvelope[] = [];

    for (const tx of txs) {
      for (const event of tx.meta) {
        metaSeq += 1;
        meta.push({ ...event, seq: metaSeq });
      }
      for (const event of tx.graph) {
        graphSeq += 1;
        graph.push({ ...event, seq: graphSeq });
      }
    }

    return { meta, graph };
  }
}

function debugSync(message: string, details: Record<string, unknown>): void {
  if (!DEBUG_SYNC_ENABLED) {
    return;
  }
  process.stdout.write(`[sync-local] ${message} ${JSON.stringify(details)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

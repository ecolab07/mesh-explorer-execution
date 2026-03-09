import { createHash } from "node:crypto";
import { canonicalString, type PrincipalContext, type TxBundle } from "@mesh/shared";
import type { LocalSyncGateway } from "./transportGateway.js";
import type { VisibleTxBundle } from "./transportGateway.js";

export interface CanonicalStateDigest {
  principalId: string;
  cursor: number;
  digest: string;
}

export type StateDigestDecisionReason =
  | "durable_cursor_advanced"
  | "subscribe_deduped"
  | "subscribe_gap_detected"
  | "subscribe_out_of_order"
  | "subscribe_invalid_tx_bundle"
  | "subscribe_blocked_requires_poll"
  | "poll_not_caught_up"
  | "digest_mismatch"
  | "validation_failed_requires_poll"
  | "poll_recovery_triggered"
  | "poll_recovery_completed"
  | "transport_delta_decision"
  | "transport_delta_ignored"
  | "transport_resync_required";

export type TransportDeltaDecision =
  | { action: "APPLY_SAFE"; reason: "cursor_contiguous" }
  | { action: "IGNORE_DUPLICATE_OR_STALE"; reason: "duplicate" | "stale" }
  | {
      action: "REQUIRES_POLL_RESYNC";
      reason: "invalid_tx_bundle" | "cursor_gap" | "cursor_regression" | "txid_mismatch";
    };

export interface StateDigestDecision {
  reason: StateDigestDecisionReason;
  durableCursor: number;
  candidateCursor: number;
  pollValidatedCursor: number;
}

interface CanonicalStateDump {
  principalId: string;
  graphSpaceId: string;
  cursor: number;
  txs: Array<{ principalCursor: number; txBundle: TxBundle }>;
}

export function computeCanonicalStateDigest(
  graphSpaceId: string,
  principal: PrincipalContext,
  state: Array<{ principalCursor: number; txBundle: TxBundle }>,
  cursor: number
): CanonicalStateDigest {
  const dump: CanonicalStateDump = {
    principalId: principal.principalId,
    graphSpaceId,
    cursor,
    txs: state.map((entry) => ({
      principalCursor: entry.principalCursor,
      txBundle: {
        txId: entry.txBundle.txId,
        metaEvents: entry.txBundle.metaEvents,
        graphEvents: entry.txBundle.graphEvents
      }
    }))
  };
  const canonical = canonicalString(dump);
  return {
    principalId: principal.principalId,
    cursor,
    digest: createHash("sha256").update(canonical).digest("hex")
  };
}

export class StateDigestSyncClient {
  private durableCursor = 0;
  private durableState: Array<{ principalCursor: number; txBundle: TxBundle }> = [];
  private candidateCursor = 0;
  private candidateState: Array<{ principalCursor: number; txBundle: TxBundle }> = [];
  private pollValidatedCursor = 0;
  private readonly seenTxIds = new Set<string>();
  private needsPoll = false;
  private readonly decisions: StateDigestDecision[] = [];

  constructor(
    private readonly gateway: LocalSyncGateway,
    private readonly graphSpaceId: string,
    private readonly principal: PrincipalContext
  ) {}

  getDurableCursor(): number {
    return this.durableCursor;
  }

  getCandidateCursor(): number {
    return this.candidateCursor;
  }

  getPollValidatedCursor(): number {
    return this.pollValidatedCursor;
  }

  getDecisionLog(): StateDigestDecision[] {
    return [...this.decisions];
  }

  initializeDurableState(state: Array<{ principalCursor: number; txBundle: TxBundle }>, cursor: number): void {
    this.durableState = [...state];
    this.durableCursor = cursor;
    this.candidateState = [...state];
    this.candidateCursor = cursor;
    this.pollValidatedCursor = cursor;
    this.seenTxIds.clear();
    for (const tx of state) {
      this.seenTxIds.add(tx.txBundle.txId);
    }
    this.needsPoll = false;
  }

  ingestSubscribeTxBundles(txBundlesVisible: VisibleTxBundle[]): { accepted: number; requiresPoll: boolean } {
    if (this.needsPoll) {
      this.recordDecision("subscribe_blocked_requires_poll");
      return { accepted: 0, requiresPoll: true };
    }

    let accepted = 0;

    for (const bundle of txBundlesVisible) {
      const decision = this.evaluateTransportDelta(bundle);
      this.recordDecision("transport_delta_decision");
      debugTransport("TRANSPORT_DELTA_DECISION", {
        action: decision.action,
        reason: decision.reason,
        candidateCursor: this.candidateCursor,
        principalCursor: bundle.principalCursor,
        txId: bundle.txBundle?.txId
      });

      if (decision.action === "IGNORE_DUPLICATE_OR_STALE") {
        this.recordDecision("transport_delta_ignored");
        this.recordDecision("subscribe_deduped");
        debugTransport("TRANSPORT_DELTA_IGNORED", {
          reason: decision.reason,
          principalCursor: bundle.principalCursor,
          txId: bundle.txBundle?.txId
        });
        continue;
      }

      if (decision.action === "REQUIRES_POLL_RESYNC") {
        this.recordDecision("transport_resync_required");
        const reason: StateDigestDecisionReason = decision.reason === "invalid_tx_bundle"
          ? "subscribe_invalid_tx_bundle"
          : decision.reason === "cursor_gap"
            ? "subscribe_gap_detected"
            : "subscribe_out_of_order";
        this.triggerPollRecovery(reason);
        debugTransport("TRANSPORT_RESYNC_REQUIRED", {
          reason: decision.reason,
          principalCursor: bundle.principalCursor,
          txId: bundle.txBundle?.txId
        });
        break;
      }

      this.candidateState.push(bundle);
      this.seenTxIds.add(bundle.txBundle.txId);
      this.candidateCursor = bundle.principalCursor;
      accepted += 1;
    }

    return { accepted, requiresPoll: this.needsPoll };
  }

  private evaluateTransportDelta(bundle: VisibleTxBundle): TransportDeltaDecision {
    if (!isWellFormedTxBundle(bundle.txBundle)) {
      return { action: "REQUIRES_POLL_RESYNC", reason: "invalid_tx_bundle" };
    }

    if (bundle.principalCursor < this.candidateCursor) {
      return this.seenTxIds.has(bundle.txBundle.txId)
        ? { action: "IGNORE_DUPLICATE_OR_STALE", reason: "stale" }
        : { action: "REQUIRES_POLL_RESYNC", reason: "cursor_regression" };
    }

    if (bundle.principalCursor === this.candidateCursor) {
      return this.seenTxIds.has(bundle.txBundle.txId)
        ? { action: "IGNORE_DUPLICATE_OR_STALE", reason: "duplicate" }
        : { action: "REQUIRES_POLL_RESYNC", reason: "txid_mismatch" };
    }

    if (bundle.principalCursor !== this.candidateCursor + 1) {
      return { action: "REQUIRES_POLL_RESYNC", reason: "cursor_gap" };
    }

    if (this.seenTxIds.has(bundle.txBundle.txId)) {
      return { action: "REQUIRES_POLL_RESYNC", reason: "txid_mismatch" };
    }

    return { action: "APPLY_SAFE", reason: "cursor_contiguous" };
  }

  async validateAndCommit(limitTx = 128): Promise<{ committed: boolean; requiresPoll: boolean; durableCursor: number }> {
    const polledDelta = await this.collectFromCursor(this.durableCursor, limitTx);
    const polledState = [...this.durableState, ...polledDelta.txs];
    this.pollValidatedCursor = polledDelta.cursorAfter;

    if (this.pollValidatedCursor < this.candidateCursor) {
      this.triggerPollRecovery("poll_not_caught_up");
      this.rollbackCandidateToDurable();
      return { committed: false, requiresPoll: true, durableCursor: this.durableCursor };
    }

    const candidateDigest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, this.candidateState, this.candidateCursor);
    const polledDigest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, polledState, polledDelta.cursorAfter);

    const canCommit = !this.needsPoll && this.candidateCursor === polledDelta.cursorAfter && candidateDigest.digest === polledDigest.digest;

    if (canCommit) {
      this.durableCursor = this.candidateCursor;
      this.durableState = [...this.candidateState];
      this.recordDecision("durable_cursor_advanced");
      return { committed: true, requiresPoll: false, durableCursor: this.durableCursor };
    }

    this.triggerPollRecovery("digest_mismatch");
    this.recordDecision("validation_failed_requires_poll");
    this.rollbackCandidateToDurable();
    return { committed: false, requiresPoll: true, durableCursor: this.durableCursor };
  }

  async recoverByFullPoll(limitTx = 128): Promise<{ cursor: number; digest: CanonicalStateDigest }> {
    this.recordDecision("poll_recovery_triggered");
    const full = await this.collectFromCursor(0, limitTx);
    this.candidateState = [...full.txs];
    this.candidateCursor = full.cursorAfter;
    this.pollValidatedCursor = full.cursorAfter;
    this.seenTxIds.clear();
    for (const tx of this.candidateState) {
      this.seenTxIds.add(tx.txBundle.txId);
    }
    const digest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, this.candidateState, this.candidateCursor);
    this.needsPoll = false;
    this.recordDecision("poll_recovery_completed");
    return { cursor: full.cursorAfter, digest };
  }

  snapshotDigest(): CanonicalStateDigest {
    return computeCanonicalStateDigest(this.graphSpaceId, this.principal, this.candidateState, this.candidateCursor);
  }

  private async collectFromCursor(
    fromCursorExclusive: number,
    limitTx: number
  ): Promise<{ txs: Array<{ principalCursor: number; txBundle: TxBundle }>; cursorAfter: number }> {
    const txs: Array<{ principalCursor: number; txBundle: TxBundle }> = [];
    let cursor = fromCursorExclusive;

    for (let rounds = 0; rounds < 256; rounds += 1) {
      const pulled = await this.gateway.syncPull(this.graphSpaceId, this.principal, cursor, { limitTx });
      if (pulled.txBundlesVisible.length === 0) {
        break;
      }
      txs.push(...pulled.txBundlesVisible);
      cursor = pulled.cursorAfterVisible;
    }

    return { txs, cursorAfter: cursor };
  }

  private triggerPollRecovery(reason: StateDigestDecisionReason): void {
    this.needsPoll = true;
    this.recordDecision(reason);
  }

  private rollbackCandidateToDurable(): void {
    this.candidateCursor = this.durableCursor;
    this.candidateState = [...this.durableState];
    this.seenTxIds.clear();
    for (const tx of this.candidateState) {
      this.seenTxIds.add(tx.txBundle.txId);
    }
  }

  private recordDecision(reason: StateDigestDecisionReason): void {
    this.decisions.push({
      reason,
      durableCursor: this.durableCursor,
      candidateCursor: this.candidateCursor,
      pollValidatedCursor: this.pollValidatedCursor
    });
  }
}

const DEBUG_TRANSPORT_SYNC = process.env.MESH_DEBUG_SYNC === "1";

function debugTransport(event: "TRANSPORT_DELTA_DECISION" | "TRANSPORT_RESYNC_REQUIRED" | "TRANSPORT_DELTA_IGNORED", payload: Record<string, unknown>): void {
  if (!DEBUG_TRANSPORT_SYNC) return;
  console.debug("[mesh-sync]", { event, ...payload });
}

function isWellFormedTxBundle(txBundle: TxBundle): boolean {
  return (
    typeof txBundle.txId === "string" &&
    txBundle.txId.length > 0 &&
    Array.isArray(txBundle.metaEvents) &&
    Array.isArray(txBundle.graphEvents)
  );
}

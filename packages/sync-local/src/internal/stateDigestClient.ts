import { createHash } from "node:crypto";
import { canonicalString, type PrincipalContext, type TxBundle } from "@mesh/shared";
import type { LocalSyncGateway } from "./transportGateway.js";
import type { VisibleTxBundle } from "./transportGateway.js";

export interface CanonicalStateDigest {
  principalId: string;
  cursor: number;
  digest: string;
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
  private readonly seenTxIds = new Set<string>();
  private needsPoll = false;

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

  initializeDurableState(state: Array<{ principalCursor: number; txBundle: TxBundle }>, cursor: number): void {
    this.durableState = [...state];
    this.durableCursor = cursor;
    this.candidateState = [...state];
    this.candidateCursor = cursor;
    this.seenTxIds.clear();
    for (const tx of state) {
      this.seenTxIds.add(tx.txBundle.txId);
    }
    this.needsPoll = false;
  }

  ingestSubscribeTxBundles(txBundlesVisible: VisibleTxBundle[]): { accepted: number; requiresPoll: boolean } {
    let accepted = 0;

    for (const bundle of txBundlesVisible) {
      if (bundle.principalCursor <= this.candidateCursor) {
        if (this.seenTxIds.has(bundle.txBundle.txId)) {
          continue;
        }
        this.needsPoll = true;
        continue;
      }

      if (bundle.principalCursor !== this.candidateCursor + 1) {
        this.needsPoll = true;
        break;
      }

      if (this.seenTxIds.has(bundle.txBundle.txId)) {
        continue;
      }

      this.candidateState.push(bundle);
      this.seenTxIds.add(bundle.txBundle.txId);
      this.candidateCursor = bundle.principalCursor;
      accepted += 1;
    }

    return { accepted, requiresPoll: this.needsPoll };
  }

  async validateAndCommit(limitTx = 128): Promise<{ committed: boolean; requiresPoll: boolean; durableCursor: number }> {
    const polledDelta = await this.collectFromCursor(this.durableCursor, limitTx);
    const polledState = [...this.durableState, ...polledDelta.txs];

    const candidateDigest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, this.candidateState, this.candidateCursor);
    const polledDigest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, polledState, polledDelta.cursorAfter);

    const canCommit = !this.needsPoll && this.candidateCursor === polledDelta.cursorAfter && candidateDigest.digest === polledDigest.digest;

    if (canCommit) {
      this.durableCursor = this.candidateCursor;
      this.durableState = [...this.candidateState];
      return { committed: true, requiresPoll: false, durableCursor: this.durableCursor };
    }

    this.needsPoll = true;
    this.candidateCursor = this.durableCursor;
    this.candidateState = [...this.durableState];
    return { committed: false, requiresPoll: true, durableCursor: this.durableCursor };
  }

  async recoverByFullPoll(limitTx = 128): Promise<{ cursor: number; digest: CanonicalStateDigest }> {
    const full = await this.collectFromCursor(0, limitTx);
    this.candidateState = [...full.txs];
    this.candidateCursor = full.cursorAfter;
    this.seenTxIds.clear();
    for (const tx of this.candidateState) {
      this.seenTxIds.add(tx.txBundle.txId);
    }
    const digest = computeCanonicalStateDigest(this.graphSpaceId, this.principal, this.candidateState, this.candidateCursor);
    this.needsPoll = false;
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
}

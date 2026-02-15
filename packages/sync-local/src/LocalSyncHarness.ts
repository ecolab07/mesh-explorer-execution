import type { LocalEventStore } from "@mesh/eventstore-local";
import type { PrincipalContext } from "@mesh/shared";

export interface SyncPollReceipt {
  principalCursorAfter: number;
  txIds: string[];
}

export class LocalSyncHarness {
  constructor(private readonly eventStore: LocalEventStore, private readonly graphSpaceId: string) {}

  async poll(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt> {
    const { txs, cursor } = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, fromCursorExclusive, limit, principal);
    return {
      principalCursorAfter: cursor,
      txIds: txs.map((tx) => tx.txId)
    };
  }

  async subscribeOnce(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt> {
    return this.poll(principal, fromCursorExclusive, limit);
  }
}

import type { LocalEventStore } from "@mesh/eventstore-local";
import type { PrincipalContext } from "@mesh/shared";
import { LocalSyncGateway } from "./internal/transportGateway.js";

export interface SyncPollReceipt {
  principalCursorAfter: number;
  txIds: string[];
}

export class LocalSyncHarness {
  private readonly gateway: LocalSyncGateway;

  constructor(private readonly eventStore: LocalEventStore, private readonly graphSpaceId: string) {
    this.gateway = new LocalSyncGateway(eventStore, { graphSpaceId });
  }

  async poll(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt> {
    const pulled = await this.gateway.syncPull(this.graphSpaceId, principal, fromCursorExclusive, { limitTx: limit });
    return {
      principalCursorAfter: pulled.cursorAfterVisible,
      txIds: pulled.txBundlesVisible.map((tx) => tx.txBundle.txId)
    };
  }

  async subscribeOnce(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt> {
    return this.poll(principal, fromCursorExclusive, limit);
  }
}

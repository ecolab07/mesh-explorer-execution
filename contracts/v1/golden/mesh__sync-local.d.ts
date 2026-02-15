import type { LocalEventStore } from "@mesh/eventstore-local";
import type { PrincipalContext } from "@mesh/shared";
export interface SyncPollReceipt {
    principalCursorAfter: number;
    txIds: string[];
}
export declare class LocalSyncHarness {
    private readonly eventStore;
    private readonly graphSpaceId;
    constructor(eventStore: LocalEventStore, graphSpaceId: string);
    poll(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt>;
    subscribeOnce(principal: PrincipalContext, fromCursorExclusive: number, limit: number): Promise<SyncPollReceipt>;
}

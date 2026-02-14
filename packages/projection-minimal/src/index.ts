import type { LocalEventStore } from "@mesh/eventstore-local";
import type { PrincipalContext } from "@mesh/shared";

export interface ProjectionSnapshot {
  principalId: string;
  cursor: number;
  nodeCount: number;
  txIds: string[];
}

export class PrincipalProjectionEngine {
  private readonly cache = new Map<string, ProjectionSnapshot>();

  constructor(private readonly eventStore: LocalEventStore, private readonly graphSpaceId: string) {}

  async rebuild(principal: PrincipalContext): Promise<ProjectionSnapshot> {
    const head = await this.eventStore.getPrincipalCursorHead(this.graphSpaceId, principal);
    const { txs } = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, 0, head, principal);
    const projection = this.compute(principal.principalId, txs.map((tx) => tx.txId), txs.length);
    this.cache.set(principal.principalId, projection);
    return projection;
  }

  async incremental(principal: PrincipalContext): Promise<ProjectionSnapshot> {
    const prior = this.cache.get(principal.principalId) ?? this.compute(principal.principalId, [], 0);
    const delta = await this.eventStore.readPrincipalTxRange(this.graphSpaceId, prior.cursor, Number.MAX_SAFE_INTEGER, principal);
    const merged = this.compute(principal.principalId, [...prior.txIds, ...delta.txs.map((tx) => tx.txId)], prior.cursor + delta.txs.length);
    this.cache.set(principal.principalId, merged);
    return merged;
  }

  invalidate(graphSpaceId: string): void {
    if (graphSpaceId === this.graphSpaceId) {
      this.cache.clear();
    }
  }

  private compute(principalId: string, txIds: string[], cursor: number): ProjectionSnapshot {
    return {
      principalId,
      cursor,
      txIds,
      nodeCount: txIds.length
    };
  }
}

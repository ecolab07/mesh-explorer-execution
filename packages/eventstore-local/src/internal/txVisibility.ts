import type { AccessEffect, EventAccessPolicy, EventEnvelope, PrincipalContext, TxId, TxIndexEntry } from "@mesh/shared";

export type PrincipalId = string;

export interface VisibilityContext {
  principalId: PrincipalId;
}

export interface TxVisibilityBundle {
  txId: TxId;
  txIndex: number;
  meta: EventEnvelope[];
  graph: EventEnvelope[];
}

export interface TxVisibilityDecider {
  decideTxVisibility(ctx: VisibilityContext, tx: TxVisibilityBundle): AccessEffect;
}

const SYSTEM_VISIBILITY: VisibilityContext = { principalId: "system" };

export function toVisibilityContext(principal?: PrincipalContext): VisibilityContext {
  return principal ? { principalId: principal.principalId } : SYSTEM_VISIBILITY;
}

export function createDefaultTxVisibilityDecider(): TxVisibilityDecider {
  return {
    decideTxVisibility: () => "allow"
  };
}

export function createAclTxVisibilityDecider(): TxVisibilityDecider {
  return {
    decideTxVisibility: (ctx, tx) => {
      const effects = [...tx.meta, ...tx.graph].map((event) => resolveEventAccess(event, ctx.principalId));
      if (effects.some((effect) => effect === "deny")) return "deny";
      if (effects.some((effect) => effect === "mask")) return "mask";
      return "allow";
    }
  };
}

/**
 * Internal deterministic test policy for security activation tests.
 * If any event in a tx references entityId="E-secret", tx is masked for principal "user".
 */
export function createEntitySecretMaskDecider(): TxVisibilityDecider {
  return {
    decideTxVisibility: (ctx, tx) => {
      if (ctx.principalId !== "user") {
        return "allow";
      }
      const hasSecretEntity = [...tx.meta, ...tx.graph].some((event) => {
        const payload = event.payload as { entityId?: unknown };
        return payload.entityId === "E-secret";
      });
      return hasSecretEntity ? "mask" : "allow";
    }
  };
}

export function buildTxBundles(
  txIndex: TxIndexEntry[],
  meta: EventEnvelope[],
  graph: EventEnvelope[]
): TxVisibilityBundle[] {
  const metaByTx = groupByTx(meta);
  const graphByTx = groupByTx(graph);
  return txIndex.map((entry) => ({
    txId: entry.txId,
    txIndex: entry.txIndex,
    meta: metaByTx.get(entry.txId) ?? [],
    graph: graphByTx.get(entry.txId) ?? []
  }));
}

export function filterVisibleTxs(params: {
  txs: TxVisibilityBundle[];
  fromPrincipalCursorExclusive: number;
  limit: number;
  visibility: VisibilityContext;
  decider: TxVisibilityDecider;
}): { txs: TxVisibilityBundle[]; cursor: number } {
  const visibleTxs = params.txs.filter((tx) => params.decider.decideTxVisibility(params.visibility, tx) === "allow");
  const safeCursor = Math.max(0, params.fromPrincipalCursorExclusive);
  const txs = visibleTxs.slice(safeCursor, safeCursor + params.limit).map((tx, idx) => ({
    ...tx,
    txIndex: safeCursor + idx + 1
  }));
  return {
    txs,
    cursor: safeCursor + txs.length
  };
}

export function countVisibleTxs(txs: TxVisibilityBundle[], visibility: VisibilityContext, decider: TxVisibilityDecider): number {
  return txs.filter((tx) => decider.decideTxVisibility(visibility, tx) === "allow").length;
}

function groupByTx(events: EventEnvelope[]): Map<TxId, EventEnvelope[]> {
  const grouped = new Map<TxId, EventEnvelope[]>();
  for (const event of events) {
    const current = grouped.get(event.txId);
    if (current) {
      current.push(event);
    } else {
      grouped.set(event.txId, [event]);
    }
  }
  return grouped;
}

function resolveEventAccess(event: EventEnvelope, principalId: string): AccessEffect {
  const acl = (event.payload as { _acl?: EventAccessPolicy })._acl;
  if (!acl) return "allow";
  return acl[principalId] ?? acl["*"] ?? "allow";
}

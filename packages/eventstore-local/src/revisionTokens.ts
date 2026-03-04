import type { Cursor, TxIndexEntry } from "@mesh/shared";

const REVISION_ROOT_TOKEN = "rev:root";
const TX_TOKEN_PREFIX = "rev:tx:";

export function revisionTokenForHead(txIndex: TxIndexEntry[]): string {
  const last = txIndex[txIndex.length - 1];
  return last ? `${TX_TOKEN_PREFIX}${last.txId}` : REVISION_ROOT_TOKEN;
}

export function resolveRevisionTokenToCursor(revisionToken: string, txIndex: TxIndexEntry[]): Cursor | null {
  if (revisionToken === REVISION_ROOT_TOKEN) {
    return { metaSeq: 0, graphSeq: 0 };
  }

  if (!revisionToken.startsWith(TX_TOKEN_PREFIX)) {
    return null;
  }

  const txId = revisionToken.slice(TX_TOKEN_PREFIX.length);
  if (!txId) return null;

  const txEntry = txIndex.find((entry) => entry.txId === txId);
  if (!txEntry) return null;

  return { metaSeq: txEntry.meta.end, graphSeq: txEntry.graph.end };
}


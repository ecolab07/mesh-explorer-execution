export type SubscribeTxBundle = {
  principalCursor?: number;
  txBundle?: { graphEvents?: unknown[]; metaEvents?: unknown[] };
};

export type SubscribeConvergenceDecision =
  | {
      action: "apply";
      expectedGraphSeq: number;
      graphEventsCount: number;
      subscribePrincipalCursor: number | null;
    }
  | {
      action: "fallback-poll";
      reason: "missing-principal-cursor" | "principal-cursor-mismatch";
      expectedGraphSeq: number;
      graphEventsCount: number;
      subscribePrincipalCursor: number | null;
    };

export function evaluateSubscribeConvergence(currentGraphSeq: number, txBundles: SubscribeTxBundle[]): SubscribeConvergenceDecision {
  const graphEventsCount = countGraphEvents(txBundles);
  const expectedGraphSeq = currentGraphSeq + graphEventsCount;
  const subscribePrincipalCursor = readMaxPrincipalCursor(txBundles);

  if (subscribePrincipalCursor === null) {
    return {
      action: "fallback-poll",
      reason: "missing-principal-cursor",
      expectedGraphSeq,
      graphEventsCount,
      subscribePrincipalCursor
    };
  }

  if (subscribePrincipalCursor !== expectedGraphSeq) {
    return {
      action: "fallback-poll",
      reason: "principal-cursor-mismatch",
      expectedGraphSeq,
      graphEventsCount,
      subscribePrincipalCursor
    };
  }

  return {
    action: "apply",
    expectedGraphSeq,
    graphEventsCount,
    subscribePrincipalCursor
  };
}

function countGraphEvents(txBundles: SubscribeTxBundle[]): number {
  let count = 0;
  for (const bundle of txBundles) {
    count += bundle.txBundle?.graphEvents?.length ?? 0;
  }
  return count;
}

function readMaxPrincipalCursor(txBundles: SubscribeTxBundle[]): number | null {
  let maxCursor: number | null = null;
  for (const bundle of txBundles) {
    if (typeof bundle.principalCursor !== "number") continue;
    maxCursor = maxCursor === null ? bundle.principalCursor : Math.max(maxCursor, bundle.principalCursor);
  }
  return maxCursor;
}

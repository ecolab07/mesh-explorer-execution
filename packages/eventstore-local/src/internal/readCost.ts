export type ReadCostSnapshot = {
  eventsScanned: number;
  txIndexLookups: number;
  rangeReads: number;
};

const readCost: ReadCostSnapshot = {
  eventsScanned: 0,
  txIndexLookups: 0,
  rangeReads: 0
};

function trackingEnabled(): boolean {
  return process.env.MESH_READ_COST === "1";
}

function mutate(mutator: (snapshot: ReadCostSnapshot) => void): void {
  if (!trackingEnabled()) {
    return;
  }
  mutator(readCost);
}

export function recordEventsScanned(count: number): void {
  if (count <= 0) {
    return;
  }
  mutate((snapshot) => {
    snapshot.eventsScanned += count;
  });
}

export function recordTxIndexLookup(count = 1): void {
  if (count <= 0) {
    return;
  }
  mutate((snapshot) => {
    snapshot.txIndexLookups += count;
  });
}

export function recordRangeRead(count = 1): void {
  if (count <= 0) {
    return;
  }
  mutate((snapshot) => {
    snapshot.rangeReads += count;
  });
}

export function resetReadCostForTests(): void {
  readCost.eventsScanned = 0;
  readCost.txIndexLookups = 0;
  readCost.rangeReads = 0;
}

export function getReadCostSnapshotForTests(): ReadCostSnapshot {
  return { ...readCost };
}

export interface SeededRng {
  next(): number;
  nextInt(maxExclusive: number): number;
  chance(probability: number): boolean;
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };

  return {
    next,
    nextInt(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
        return 0;
      }
      return Math.floor(next() * maxExclusive);
    },
    chance(probability: number): boolean {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    }
  };
}

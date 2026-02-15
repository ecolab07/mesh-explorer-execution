import { createSeededRng, type SeededRng } from "./seededRng.js";

export interface SimMessage<TPayload> {
  from: string;
  to: string;
  payload: TPayload;
}

export interface SimNetworkOptions {
  maxQueueSize?: number;
}

export interface SimNetworkStats {
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  partitions: number;
  heals: number;
}

export class SimNetwork<TPayload> {
  private readonly queue: Array<SimMessage<TPayload>> = [];
  private readonly partitions = new Set<string>();
  private readonly maxQueueSize: number;
  private readonly counters: SimNetworkStats = {
    delivered: 0,
    dropped: 0,
    duplicated: 0,
    reordered: 0,
    partitions: 0,
    heals: 0
  };

  constructor(
    private readonly rng: SeededRng,
    options: SimNetworkOptions = {}
  ) {
    this.maxQueueSize = options.maxQueueSize ?? Number.POSITIVE_INFINITY;
  }

  send(message: SimMessage<TPayload>): void {
    if (this.isPartitioned(message.from, message.to)) {
      this.counters.dropped += 1;
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.counters.dropped += 1;
    }
    this.queue.push(message);
  }

  tick(): SimMessage<TPayload> | undefined {
    const message = this.queue.shift();
    if (message) {
      this.counters.delivered += 1;
    }
    return message;
  }

  drop(probability: number): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.rng.chance(probability)) {
        this.queue.splice(index, 1);
        this.counters.dropped += 1;
      }
    }
  }

  duplicate(probability: number): void {
    const copies: Array<{ index: number; message: SimMessage<TPayload> }> = [];
    for (let index = 0; index < this.queue.length; index += 1) {
      if (this.rng.chance(probability)) {
        copies.push({ index: index + 1, message: this.queue[index] });
      }
    }
    for (let index = copies.length - 1; index >= 0; index -= 1) {
      const copy = copies[index];
      this.queue.splice(copy.index, 0, { ...copy.message, payload: structuredClone(copy.message.payload) });
      this.counters.duplicated += 1;
    }
  }

  reorder(): void {
    if (this.queue.length < 2) return;
    const left = this.rng.nextInt(this.queue.length);
    let right = this.rng.nextInt(this.queue.length);
    if (left === right) {
      right = (right + 1) % this.queue.length;
    }
    const tmp = this.queue[left];
    this.queue[left] = this.queue[right];
    this.queue[right] = tmp;
    this.counters.reordered += 1;
  }

  pending(): number {
    return this.queue.length;
  }

  partition(peerA: string, peerB: string): void {
    this.partitions.add(makePartitionKey(peerA, peerB));
    this.counters.partitions += 1;
  }

  heal(): void {
    this.partitions.clear();
    this.counters.heals += 1;
  }

  stats(): SimNetworkStats {
    return { ...this.counters };
  }

  private isPartitioned(peerA: string, peerB: string): boolean {
    return this.partitions.has(makePartitionKey(peerA, peerB));
  }
}

function makePartitionKey(peerA: string, peerB: string): string {
  return [peerA, peerB].sort().join("::");
}

export function makeSimNetwork<TPayload>(seed: number, options: SimNetworkOptions = {}): SimNetwork<TPayload> {
  return new SimNetwork<TPayload>(createSeededRng(seed), options);
}

import { createSeededRng, type SeededRng } from "./seededRng.js";

export interface SimMessage<TPayload> {
  from: string;
  to: string;
  payload: TPayload;
}

export class SimNetwork<TPayload> {
  private readonly queue: Array<SimMessage<TPayload>> = [];

  constructor(private readonly rng: SeededRng) {}

  send(message: SimMessage<TPayload>): void {
    this.queue.push(message);
  }

  tick(): SimMessage<TPayload> | undefined {
    return this.queue.shift();
  }

  drop(probability: number): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.rng.chance(probability)) {
        this.queue.splice(index, 1);
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
  }

  pending(): number {
    return this.queue.length;
  }
}

export function makeSimNetwork<TPayload>(seed: number): SimNetwork<TPayload> {
  return new SimNetwork<TPayload>(createSeededRng(seed));
}

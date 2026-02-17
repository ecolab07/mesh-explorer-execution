import { describe, expect, it } from "vitest";
import ForceGraph2D from "../src/index.js";

class FakeElement {
  style: Record<string, string> = {};
  dataset: Record<string, string | undefined> = {};
  textContent = "";
  onclick: ((event: unknown) => void) | null = null;
  type = "";
  children: FakeElement[] = [];

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

describe("force-graph wrapper", () => {
  it("exposes onNodeClick as a function", () => {
    const fakeDocument = {
      createElement: () => new FakeElement()
    };

    const previousDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = fakeDocument;

    try {
      const container = new FakeElement() as unknown as HTMLElement;
      const instance = ForceGraph2D()(container);
      expect(typeof instance.onNodeClick).toBe("function");
    } finally {
      (globalThis as Record<string, unknown>).document = previousDocument;
    }
  });
});

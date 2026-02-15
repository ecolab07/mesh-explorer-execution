import { describe, expect, it } from "vitest";
import { canonicalStringify, sha256Hex } from "../src/canonical.js";

describe("canonicalStringify", () => {
  it("normalizes object key order for semantic equivalence", () => {
    const payloadA = { a: 1, b: { x: 2, y: 3 } };
    const payloadB = { b: { y: 3, x: 2 }, a: 1 };

    const hashA = sha256Hex(canonicalStringify(payloadA));
    const hashB = sha256Hex(canonicalStringify(payloadB));

    expect(hashA).toBe(hashB);
  });

  it("keeps arrays order-sensitive", () => {
    const hashA = sha256Hex(canonicalStringify([1, 2]));
    const hashB = sha256Hex(canonicalStringify([2, 1]));

    expect(hashA).not.toBe(hashB);
  });

  it("rejects cycles", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalStringify(cyclic)).toThrow("Cannot canonicalize cyclic structures");
  });
});

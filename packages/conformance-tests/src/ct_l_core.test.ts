import { describe, expect, it } from "vitest";
import { canonicalString, stripNondeterminism } from "@mesh/shared";

describe("CT-L-* Core Local", () => {
  it.todo("CT-L-1 Append-only immutability (Critical)");
  it.todo("CT-L-2 tx-closed readRange extension (Critical)");
  it.todo("CT-L-3 Two-stream ordering (Critical)");
  it.todo("CT-L-4 Tx boundary integrity (Critical)");
  it.todo("CT-L-5 Idempotency atomicity crash-safety (Critical, simulated)");

  it("sanity: canonical normalizer is deterministic and strips createdAt", () => {
    const a = {
      z: 1,
      a: { createdAt: "2024-01-01T00:00:00Z", name: "node" }
    };
    const b = {
      a: { createdAt: "2025-01-01T00:00:00Z", name: "node" },
      z: 1
    };

    expect(stripNondeterminism(a)).toEqual({ a: { name: "node" }, z: 1 });
    expect(canonicalString(a)).toEqual(canonicalString(b));
  });
});

import { describe, expect, it } from "vitest";

import { evaluateSubscribeConvergence } from "../src/syncConvergenceGuard.js";

describe("evaluateSubscribeConvergence", () => {
  it("falls back to poll when subscribe principal cursor diverges from expected graph progression", () => {
    const decision = evaluateSubscribeConvergence(0, [
      {
        principalCursor: 1,
        txBundle: {
          metaEvents: [{ type: "meta.only" }],
          graphEvents: []
        }
      }
    ]);

    expect(decision).toEqual({
      action: "fallback-poll",
      reason: "principal-cursor-mismatch",
      expectedGraphSeq: 0,
      graphEventsCount: 0,
      subscribePrincipalCursor: 1
    });
  });

  it("falls back to poll when subscribe tx-bundle has no principal cursor", () => {
    const decision = evaluateSubscribeConvergence(3, [
      {
        txBundle: {
          graphEvents: [{ type: "graph.node.created" }]
        }
      }
    ]);

    expect(decision).toEqual({
      action: "fallback-poll",
      reason: "missing-principal-cursor",
      expectedGraphSeq: 4,
      graphEventsCount: 1,
      subscribePrincipalCursor: null
    });
  });

  it("applies subscribe batch when principal cursor matches expected graph seq", () => {
    const decision = evaluateSubscribeConvergence(4, [
      {
        principalCursor: 6,
        txBundle: {
          graphEvents: [{ type: "graph.node.created" }, { type: "graph.node.created" }]
        }
      }
    ]);

    expect(decision).toEqual({
      action: "apply",
      expectedGraphSeq: 6,
      graphEventsCount: 2,
      subscribePrincipalCursor: 6
    });
  });
});

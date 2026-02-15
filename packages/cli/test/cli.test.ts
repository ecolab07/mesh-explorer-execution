import { describe, expect, it } from "vitest";
import { buildRuntimeConfig, parseArgs } from "../src/args.js";

describe("@mesh/cli arg parsing", () => {
  it("parses write flags", () => {
    const parsed = parseArgs([
      "write",
      "--rootDir",
      "./tmp",
      "--graphSpaceId",
      "space-a",
      "--principalId",
      "principal-a",
      "--actorId",
      "actor-a",
      "--commandId",
      "cmd-1",
      "--idempotencyKey",
      "idem-1",
      "--payloadJson",
      '{"x":1}'
    ]);

    expect(parsed.command).toBe("write");
    expect(parsed.flags.rootDir).toBe("./tmp");
    expect(parsed.flags.payloadJson).toBe('{"x":1}');
  });

  it("requires values for flags", () => {
    expect(() => parseArgs(["read", "--rootDir"])).toThrow("Missing value for --rootDir");
  });

  it("builds runtime config with optional tuning flags", () => {
    const cfg = buildRuntimeConfig({
      rootDir: "./tmp",
      graphSpaceId: "space-a",
      principalId: "principal-a",
      snapshotMinTx: "1",
      snapshotIntervalMs: "100",
      replayMaxTx: "5",
      replayMaxMs: "50"
    });

    expect(cfg.snapshotPolicy).toEqual({ minTx: 1, intervalMs: 100 });
    expect(cfg.replayBudget).toEqual({ maxTx: 5, maxMs: 50 });
  });
});

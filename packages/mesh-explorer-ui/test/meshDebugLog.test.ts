import { describe, expect, it, vi } from "vitest";

import { emitMeshDebugLogToSinks } from "../src/meshDebugLog.js";

describe("emitMeshDebugLogToSinks", () => {
  it("always sends structured log to __meshDebug collector", () => {
    const log = vi.fn();
    const fakeWindow = { __meshDebug: { log } } as unknown as Window;

    emitMeshDebugLogToSinks(fakeWindow, "BOOTSTRAP_DECISION", { cursor: 42 }, { devMode: false });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("BOOTSTRAP_DECISION", { cursor: 42 });
  });

  it("mirrors structured log to console.info in dev mode", () => {
    const log = vi.fn();
    const consoleInfo = vi.fn();
    const fakeWindow = { __meshDebug: { log } } as unknown as Window;

    emitMeshDebugLogToSinks(fakeWindow, "BOOTSTRAP_DECISION", { reason: "snapshot-reset" }, { devMode: true, consoleInfo });

    expect(log).toHaveBeenCalledWith("BOOTSTRAP_DECISION", { reason: "snapshot-reset" });
    expect(consoleInfo).toHaveBeenCalledTimes(1);
    expect(consoleInfo).toHaveBeenCalledWith("[mesh-observe]", {
      message: "BOOTSTRAP_DECISION",
      detail: { reason: "snapshot-reset" }
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolveDevRoutingConfig, resolveRoutingDiagnostic } from "./devRouting";

describe("resolveDevRoutingConfig", () => {
  it("uses development defaults", () => {
    const resolved = resolveDevRoutingConfig("development", {});
    expect(resolved.apiBaseUrl).toBe("http://127.0.0.1:8090");
    expect(resolved.subscribeBaseUrl).toBe("http://127.0.0.1:8090");
  });

  it("uses proxy defaults", () => {
    const resolved = resolveDevRoutingConfig("proxy", {});
    expect(resolved.apiBaseUrl).toBe("http://127.0.0.1:8090");
    expect(resolved.subscribeBaseUrl).toBe("http://127.0.0.1:8091");
  });

  it("prioritizes explicit environment overrides", () => {
    const resolved = resolveDevRoutingConfig("development", {
      MESH_API_BASE_URL: "http://127.0.0.1:9000",
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001"
    });
    expect(resolved.apiBaseUrl).toBe("http://127.0.0.1:9000");
    expect(resolved.subscribeBaseUrl).toBe("http://127.0.0.1:9001");
  });
});

describe("resolveRoutingDiagnostic", () => {
  it("reports resolved runtime values from import.meta.env", () => {
    const diagnostic = resolveRoutingDiagnostic({
      MODE: "proxy",
      MESH_API_BASE_URL: "http://127.0.0.1:8090",
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:8091"
    });

    expect(diagnostic).toEqual({
      mode: "proxy",
      apiBaseUrl: "http://127.0.0.1:8090",
      subscribeBaseUrl: "http://127.0.0.1:8091"
    });
  });
});

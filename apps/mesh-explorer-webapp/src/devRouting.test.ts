import { describe, expect, it } from "vitest";

import { resolveDevRoutingConfig, resolveModeScopedRoutingEnv, resolveRoutingDiagnostic } from "./devRouting";

describe("resolveModeScopedRoutingEnv", () => {
  it("ignores ambient generic overrides in development mode", () => {
    const resolved = resolveModeScopedRoutingEnv("development", {
      MESH_API_BASE_URL: "http://127.0.0.1:9000",
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001"
    });

    expect(resolved).toEqual({
      MESH_API_BASE_URL: undefined,
      MESH_SUBSCRIBE_BASE_URL: undefined
    });
  });

  it("uses generic overrides in proxy mode", () => {
    const resolved = resolveModeScopedRoutingEnv("proxy", {
      MESH_API_BASE_URL: "http://127.0.0.1:9000",
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001"
    });

    expect(resolved).toEqual({
      MESH_API_BASE_URL: "http://127.0.0.1:9000",
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001"
    });
  });

  it("prefers mode-scoped overrides when provided", () => {
    const development = resolveModeScopedRoutingEnv("development", {
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001",
      MESH_SUBSCRIBE_BASE_URL_DEVELOPMENT: "http://127.0.0.1:8090"
    });
    const proxy = resolveModeScopedRoutingEnv("proxy", {
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:9001",
      MESH_SUBSCRIBE_BASE_URL_PROXY: "http://127.0.0.1:8091"
    });

    expect(development.MESH_SUBSCRIBE_BASE_URL).toBe("http://127.0.0.1:8090");
    expect(proxy.MESH_SUBSCRIBE_BASE_URL).toBe("http://127.0.0.1:8091");
  });
});

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

  it("keeps development and proxy resolution isolated when run sequentially", () => {
    const ambientProxyEnv = {
      MESH_SUBSCRIBE_BASE_URL: "http://127.0.0.1:8091"
    };

    const proxy = resolveDevRoutingConfig("proxy", resolveModeScopedRoutingEnv("proxy", ambientProxyEnv));
    const development = resolveDevRoutingConfig("development", resolveModeScopedRoutingEnv("development", ambientProxyEnv));

    expect(proxy.subscribeBaseUrl).toBe("http://127.0.0.1:8091");
    expect(development.subscribeBaseUrl).toBe("http://127.0.0.1:8090");
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

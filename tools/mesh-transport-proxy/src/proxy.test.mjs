import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { MeshTransportProxy, isSubscribeRequest } from "./proxy.mjs";

const closeables = [];

afterEach(async () => {
  while (closeables.length > 0) {
    const closeable = closeables.pop();
    if (closeable) {
      await closeable.close();
    }
  }
});

function createUpstreamServer() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/v1/test/sync:subscribe")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: ok\n\n");
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: async () => {
          await new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          });
        }
      });
    });
    server.once("error", reject);
  });
}

async function createProxy(upstreamBaseUrl) {
  const proxy = new MeshTransportProxy({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl,
    closeDelayMs: 20,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
  });

  await proxy.listen();
  return {
    baseUrl: `http://127.0.0.1:${proxy.address().port}`,
    proxy
  };
}

describe("isSubscribeRequest", () => {
  it("matches only GET /v1/{graphSpaceId}/sync:subscribe", () => {
    expect(isSubscribeRequest({ method: "GET", url: "/v1/a/sync:subscribe?cursor=1" })).toBe(true);
    expect(isSubscribeRequest({ method: "POST", url: "/v1/a/sync:subscribe" })).toBe(false);
    expect(isSubscribeRequest({ method: "GET", url: "/v1/a/sync:poll" })).toBe(false);
  });
});

describe("MeshTransportProxy control + routing", () => {
  it("returns stable state shape and validates mode input", async () => {
    const upstream = await createUpstreamServer();
    closeables.push(upstream);
    const { baseUrl, proxy } = await createProxy(upstream.baseUrl);
    closeables.push(proxy);

    const stateResponse = await fetch(`${baseUrl}/__test/transport/state`);
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toEqual({
      ok: true,
      subscribeMode: "pass",
      upstreamBaseUrl: upstream.baseUrl
    });

    const invalidResponse = await fetch(`${baseUrl}/__test/transport/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscribeMode: "bogus" })
    });

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_SUBSCRIBE_MODE" }
    });
  });

  it("keeps non-target routes as pass-through across mode changes", async () => {
    const upstream = await createUpstreamServer();
    closeables.push(upstream);
    const { baseUrl, proxy } = await createProxy(upstream.baseUrl);
    closeables.push(proxy);

    for (const subscribeMode of ["pass", "hang", "fail", "close"]) {
      await fetch(`${baseUrl}/__test/transport/mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscribeMode })
      });

      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    }
  });



  it("serves a minimal dev/test browser control UI", async () => {
    const upstream = await createUpstreamServer();
    closeables.push(upstream);
    const { baseUrl, proxy } = await createProxy(upstream.baseUrl);
    closeables.push(proxy);

    const response = await fetch(`${baseUrl}/__test/transport/ui`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Mesh Transport Proxy — Dev/Test Control");
    expect(html).toContain("/__test/transport/state");
    expect(html).toContain("/__test/transport/mode");
    for (const mode of ["pass", "fail", "hang", "close"]) {
      expect(html).toContain(`data-mode="${mode}"`);
    }
  });

  it("applies runtime mode updates without restart", async () => {
    const upstream = await createUpstreamServer();
    closeables.push(upstream);
    const { baseUrl, proxy } = await createProxy(upstream.baseUrl);
    closeables.push(proxy);

    await fetch(`${baseUrl}/__test/transport/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscribeMode: "fail" })
    });

    const failSubscribe = await fetch(`${baseUrl}/v1/test/sync:subscribe`);
    expect(failSubscribe.status).toBe(503);

    await fetch(`${baseUrl}/__test/transport/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscribeMode: "pass" })
    });

    const passSubscribe = await fetch(`${baseUrl}/v1/test/sync:subscribe`);
    expect(passSubscribe.status).toBe(200);
  });
});

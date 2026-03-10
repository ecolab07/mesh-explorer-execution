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
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
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

function readOneChunk(stream) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

function openRawSse(baseUrl, path = "/v1/test/sync:subscribe") {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "GET" }, (res) => {
      resolve({ req, res });
    });
    req.on("error", reject);
    req.end();
  });
}

function setMode(baseUrl, subscribeMode) {
  return fetch(`${baseUrl}/__test/transport/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscribeMode })
  });
}






async function closeFetchResponse(response) {
  if (response.body) {
    await response.body.cancel();
  }
}

async function waitForActiveStreamCount(proxy, expected, timeoutMs = 300) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (proxy.activeSubscribeStreams.size === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(proxy.activeSubscribeStreams.size).toBe(expected);
}

async function createProxy(upstreamBaseUrl, logger = { info: () => undefined, warn: () => undefined, error: () => undefined }) {
  const proxy = new MeshTransportProxy({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl,
    closeDelayMs: 20,
    logger
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

    await setMode(baseUrl, "fail");

    const failSubscribe = await fetch(`${baseUrl}/v1/test/sync:subscribe`);
    expect(failSubscribe.status).toBe(503);

    await setMode(baseUrl, "pass");

    const passSubscribe = await fetch(`${baseUrl}/v1/test/sync:subscribe`);
    expect(passSubscribe.status).toBe(200);
    await closeFetchResponse(passSubscribe);
  });

  it("terminates active subscribe streams for non-pass mode transitions", async () => {
    const proxy = new MeshTransportProxy({
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: "http://127.0.0.1:8090",
      closeDelayMs: 20,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    const makeStream = () => {
      const stream = {
        clientResponse: {
          writableEnded: false,
          destroyed: false,
          destroy: () => {
            stream.clientResponse.destroyed = true;
          }
        },
        upstreamRequest: { destroy: () => undefined },
        upstreamResponse: { destroy: () => undefined }
      };
      return stream;
    };

    proxy.activeSubscribeStreams.add(makeStream());
    proxy.setMode("hang");
    expect(proxy.activeSubscribeStreams.size).toBe(0);

    proxy.activeSubscribeStreams.add(makeStream());
    proxy.setMode("fail");
    expect(proxy.activeSubscribeStreams.size).toBe(0);

    proxy.activeSubscribeStreams.add(makeStream());
    proxy.setMode("close");
    expect(proxy.activeSubscribeStreams.size).toBe(0);
  });

  it("logs mode transitions with active subscribe stream handling", async () => {
    const logs = [];
    const logger = {
      info: (message) => logs.push(String(message)),
      warn: () => undefined,
      error: () => undefined
    };

    const upstream = await createUpstreamServer();
    closeables.push(upstream);
    const { baseUrl, proxy } = await createProxy(upstream.baseUrl, logger);
    closeables.push(proxy);

    const active = await openRawSse(baseUrl);
    expect(active.res.statusCode).toBe(200);
    await readOneChunk(active.res);
    await waitForActiveStreamCount(proxy, 1);

    const modeResponse = await setMode(baseUrl, "fail");
    expect(modeResponse.status).toBe(200);
    await waitForActiveStreamCount(proxy, 0);
    active.req.destroy();

    expect(logs.some((line) => line.includes("mode pass -> fail activeSubscribeStreams=1"))).toBe(true);
    expect(logs.some((line) => line.includes("terminating active subscribe streams count=1 mode=fail"))).toBe(true);
    expect(logs.some((line) => line.includes("force-closing subscribe stream reason=mode:fail"))).toBe(true);
  });
});

import http from "node:http";

export const SUBSCRIBE_MODES = ["pass", "fail", "hang", "close"];

const SUBSCRIBE_ROUTE_PATTERN = /^\/v1\/[^/]+\/sync:subscribe$/;

export function isSubscribeRequest(req) {
  if (req.method !== "GET" || !req.url) {
    return false;
  }

  const parsedUrl = new URL(req.url, "http://localhost");
  return SUBSCRIBE_ROUTE_PATTERN.test(parsedUrl.pathname);
}

export function isSubscribeMode(value) {
  return typeof value === "string" && SUBSCRIBE_MODES.includes(value);
}

export class MeshTransportProxy {
  constructor(options) {
    this.options = options;
    this.logger = options.logger ?? console;
    this.subscribeMode = "pass";
    this.activeSubscribeStreams = new Set();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  async listen() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });

    this.logger.info(
      `[transport-proxy] listening on http://${this.options.host}:${this.address().port} -> ${this.options.upstreamBaseUrl}`
    );
  }

  address() {
    return this.server.address();
  }

  async close() {
    for (const stream of this.activeSubscribeStreams) {
      this.closeStream(stream);
    }

    await new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  getState() {
    return {
      ok: true,
      subscribeMode: this.subscribeMode,
      upstreamBaseUrl: this.options.upstreamBaseUrl
    };
  }

  setMode(nextMode) {
    if (this.subscribeMode === nextMode) {
      this.logger.info(`[transport-proxy] mode unchanged=${nextMode}`);
      return { ok: true, subscribeMode: this.subscribeMode };
    }

    const previousMode = this.subscribeMode;
    this.subscribeMode = nextMode;
    this.logger.info(`[transport-proxy] mode ${previousMode} -> ${nextMode}`);

    if (nextMode === "close") {
      for (const stream of this.activeSubscribeStreams) {
        if (stream.clientResponse.writableEnded || stream.clientResponse.destroyed) {
          continue;
        }
        stream.closeTimer = setTimeout(() => this.closeStream(stream), this.options.closeDelayMs);
      }
    }

    return { ok: true, subscribeMode: this.subscribeMode };
  }

  async handleRequest(req, res) {
    if (req.url === "/__test/transport/state" && req.method === "GET") {
      this.sendJson(res, 200, this.getState());
      return;
    }

    if (req.url === "/__test/transport/mode" && req.method === "POST") {
      await this.handleSetMode(req, res);
      return;
    }

    if (isSubscribeRequest(req)) {
      this.logger.info(`[transport-proxy] subscribe request mode=${this.subscribeMode} url=${req.url}`);
      await this.handleSubscribeRequest(req, res);
      return;
    }

    this.forwardRequest(req, res);
  }

  async handleSetMode(req, res) {
    const body = await this.readJsonBody(req);

    if (!isSubscribeMode(body?.subscribeMode)) {
      this.sendJson(res, 400, {
        ok: false,
        error: {
          code: "INVALID_SUBSCRIBE_MODE",
          message: "subscribeMode must be one of: pass, fail, hang, close"
        }
      });
      return;
    }

    this.sendJson(res, 200, this.setMode(body.subscribeMode));
  }

  async handleSubscribeRequest(req, res) {
    switch (this.subscribeMode) {
      case "pass": {
        this.forwardRequest(req, res, { trackSubscribeStream: true });
        return;
      }
      case "fail": {
        this.sendJson(res, 503, {
          ok: false,
          error: {
            code: "SUBSCRIBE_TRANSPORT_FAULT",
            mode: "fail",
            message: "sync:subscribe blocked by transport proxy"
          }
        });
        return;
      }
      case "hang": {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });

        const stream = { clientResponse: res };
        this.activeSubscribeStreams.add(stream);
        req.on("close", () => {
          this.activeSubscribeStreams.delete(stream);
        });
        res.on("close", () => {
          this.activeSubscribeStreams.delete(stream);
        });
        return;
      }
      case "close": {
        this.forwardRequest(req, res, { trackSubscribeStream: true, forceClose: true });
      }
    }
  }

  forwardRequest(req, res, options) {
    const upstreamUrl = new URL(req.url ?? "/", this.options.upstreamBaseUrl);
    const upstreamReq = http.request(upstreamUrl, {
      method: req.method,
      headers: req.headers
    });

    let activeStream;
    if (options?.trackSubscribeStream) {
      activeStream = { clientResponse: res, upstreamRequest: upstreamReq };
      this.activeSubscribeStreams.add(activeStream);
      res.on("close", () => {
        this.activeSubscribeStreams.delete(activeStream);
      });
    }

    upstreamReq.on("response", (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);

      if (activeStream) {
        activeStream.upstreamResponse = upstreamRes;
        if (options?.forceClose) {
          activeStream.closeTimer = setTimeout(() => this.closeStream(activeStream), this.options.closeDelayMs);
        }
      }
    });

    upstreamReq.on("error", (error) => {
      this.logger.error(`[transport-proxy] upstream error: ${error.message}`);
      if (!res.headersSent) {
        this.sendJson(res, 502, {
          ok: false,
          error: {
            code: "UPSTREAM_PROXY_ERROR",
            message: "Unable to reach upstream backend"
          }
        });
        return;
      }
      res.destroy(error);
    });

    req.on("aborted", () => {
      upstreamReq.destroy();
    });

    req.pipe(upstreamReq);
  }

  closeStream(stream) {
    if (stream.closeTimer) {
      clearTimeout(stream.closeTimer);
    }

    stream.upstreamResponse?.destroy();
    stream.upstreamRequest?.destroy();
    stream.clientResponse.destroy();
    this.activeSubscribeStreams.delete(stream);
  }

  async readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    if (chunks.length === 0) {
      return null;
    }

    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return null;
    }
  }

  sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  }
}

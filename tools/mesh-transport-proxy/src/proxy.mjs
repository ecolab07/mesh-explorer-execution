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


function renderControlUiHtml() {
  const modeButtons = SUBSCRIBE_MODES.map(
    (mode) => `<button type="button" data-mode="${mode}" style="margin:4px 6px 0 0;padding:6px 10px;">${mode}</button>`
  ).join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mesh Transport Proxy — Dev/Test Control</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui, sans-serif; margin: 20px; max-width: 760px;">
    <h1 style="margin-bottom: 8px;">Mesh Transport Proxy — Dev/Test Control</h1>
    <p style="margin-top: 0; color: #374151;">Dev/test only surface. Controls transport fault mode via existing proxy control API.</p>

    <div style="padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; margin-bottom: 12px;">
      <div><strong>Current subscribe mode:</strong> <span id="mode">(loading)</span></div>
      <div><strong>Upstream:</strong> <span id="upstream">(loading)</span></div>
      <div><strong>Last refresh:</strong> <span id="refreshed">never</span></div>
      <div id="status" style="margin-top: 8px; color: #1f2937;"></div>
    </div>

    <div style="padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; margin-bottom: 12px;">
      <div style="margin-bottom: 6px;"><strong>Set subscribe mode</strong></div>
      ${modeButtons}
      <button type="button" id="refresh" style="margin:4px 6px 0 0;padding:6px 10px;">refresh</button>
    </div>

    <p style="font-size: 12px; color: #6b7280;">
      Endpoints: <code>GET /__test/transport/state</code> and <code>POST /__test/transport/mode</code>
    </p>

    <script>
      const modeEl = document.getElementById('mode');
      const upstreamEl = document.getElementById('upstream');
      const refreshedEl = document.getElementById('refreshed');
      const statusEl = document.getElementById('status');
      const buttonEls = Array.from(document.querySelectorAll('button[data-mode]'));

      function setStatus(message, kind = 'info') {
        const colors = { info: '#1f2937', success: '#065f46', error: '#b91c1c' };
        statusEl.textContent = message;
        statusEl.style.color = colors[kind] ?? colors.info;
      }

      async function refreshState() {
        setStatus('Refreshing state…');
        try {
          const response = await fetch('/__test/transport/state');
          if (!response.ok) throw new Error('state request failed (' + response.status + ')');
          const payload = await response.json();
          modeEl.textContent = payload.subscribeMode ?? '(unknown)';
          upstreamEl.textContent = payload.upstreamBaseUrl ?? '(unknown)';
          refreshedEl.textContent = new Date().toLocaleTimeString();
          buttonEls.forEach((button) => {
            button.disabled = button.dataset.mode === payload.subscribeMode;
          });
          setStatus('State loaded.', 'success');
        } catch (error) {
          setStatus('Error loading state: ' + (error?.message ?? String(error)), 'error');
        }
      }

      async function setMode(subscribeMode) {
        setStatus('Setting mode to ' + subscribeMode + '…');
        try {
          const response = await fetch('/__test/transport/mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscribeMode })
          });
          if (!response.ok) {
            let detail = '';
            try {
              const payload = await response.json();
              detail = payload?.error?.message ? ': ' + payload.error.message : '';
            } catch {}
            throw new Error('mode update failed (' + response.status + ')' + detail);
          }
          setStatus('Mode updated to ' + subscribeMode + '.', 'success');
          await refreshState();
        } catch (error) {
          setStatus('Error updating mode: ' + (error?.message ?? String(error)), 'error');
        }
      }

      document.getElementById('refresh').addEventListener('click', () => {
        void refreshState();
      });
      buttonEls.forEach((button) => {
        button.addEventListener('click', () => {
          void setMode(button.dataset.mode);
        });
      });

      void refreshState();
    </script>
  </body>
</html>`;
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

    this.server.closeAllConnections?.();
    this.server.closeIdleConnections?.();

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
    const activeCount = this.activeSubscribeStreams.size;
    this.logger.info(`[transport-proxy] mode ${previousMode} -> ${nextMode} activeSubscribeStreams=${activeCount}`);

    if (nextMode !== "pass") {
      this.logger.info(`[transport-proxy] terminating active subscribe streams count=${activeCount} mode=${nextMode}`);
      this.terminateActiveSubscribeStreams(`mode:${nextMode}`);
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

    if (req.url === "/__test/transport/ui" && req.method === "GET") {
      this.sendHtml(res, 200, renderControlUiHtml());
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

        this.trackSubscribeStream({ clientResponse: res, clientRequest: req });
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
      activeStream = this.trackSubscribeStream({
        clientRequest: req,
        clientResponse: res,
        upstreamRequest: upstreamReq
      });
    }

    upstreamReq.on("response", (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);

      if (activeStream) {
        activeStream.upstreamResponse = upstreamRes;
        upstreamRes.on("close", () => this.activeSubscribeStreams.delete(activeStream));
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

  terminateActiveSubscribeStreams(reason) {
    for (const stream of this.activeSubscribeStreams) {
      if (stream.clientResponse.writableEnded || stream.clientResponse.destroyed) {
        this.activeSubscribeStreams.delete(stream);
        continue;
      }
      this.logger.info(`[transport-proxy] force-closing subscribe stream reason=${reason}`);
      this.closeStream(stream);
    }
  }

  trackSubscribeStream(stream) {
    this.activeSubscribeStreams.add(stream);

    const cleanup = () => {
      this.activeSubscribeStreams.delete(stream);
    };

    stream.clientRequest?.on("aborted", cleanup);
    stream.clientResponse?.on("close", cleanup);

    return stream;
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

  sendHtml(res, statusCode, body) {
    res.writeHead(statusCode, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  }
}

import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Command, CommandOutcome, PrincipalContext } from "@mesh/shared";

interface SubmitResult {
  ackTransport: { accepted: true; idempotencyKey: string };
  final: Promise<CommandOutcome>;
}

interface SyncGatewayLike {
  submit(graphSpaceId: string, principal: PrincipalContext, command: Command, idempotencyKey?: string): SubmitResult;
  syncPull(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitTx?: number; limitBytes?: number }
  ): Promise<{ txBundlesVisible: unknown[]; cursorAfterVisible: number }>;
  syncSubscribe(
    graphSpaceId: string,
    principal: PrincipalContext,
    fromCursorVisible: number,
    options?: { limitTx?: number; limitBytes?: number; heartbeatEveryMs?: number; pollIntervalMs?: number }
  ): AsyncIterable<unknown>;
}

export interface SyncHttpReferenceServerOptions {
  graphSpaceId: string;
  gateway: SyncGatewayLike;
  principalHeaderName?: string;
  submitResponseDelayMs?: number;
}

export class SyncHttpReferenceServer {
  private readonly graphSpaceId: string;
  private readonly gateway: SyncGatewayLike;
  private readonly principalHeaderName: string;
  private readonly submitResponseDelayMs: number;
  private readonly server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void this.handle(req, res);
  });

  constructor(options: SyncHttpReferenceServerOptions) {
    this.graphSpaceId = options.graphSpaceId;
    this.gateway = options.gateway;
    this.principalHeaderName = (options.principalHeaderName ?? "x-mesh-principal").toLowerCase();
    this.submitResponseDelayMs = Math.max(0, options.submitResponseDelayMs ?? 0);
  }

  async listen(port = 0, host = "127.0.0.1"): Promise<{ port: number; url: string }> {
    this.server.listen(port, host);
    await once(this.server, "listening");
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start HTTP server");
    }
    return {
      port: address.port,
      url: `http://${host}:${address.port}`
    };
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    this.server.close();
    await once(this.server, "close");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const parsedUrl = new URL(req.url ?? "/", "http://mesh.local");
      const principal = this.parsePrincipal(req);
      if (!principal) {
        this.writeJson(res, 401, {
          status: "rejected",
          category: "PERMISSION",
          reasonCode: "AUTH.PRINCIPAL_REQUIRED"
        });
        return;
      }

      const submitMatch = this.matchPath(parsedUrl.pathname, "commands:submit");
      if (req.method === "POST" && submitMatch) {
        await this.handleSubmit(res, principal, submitMatch.graphSpaceId, req);
        return;
      }

      const pullMatch = this.matchPath(parsedUrl.pathname, "sync:pull");
      if (req.method === "GET" && pullMatch) {
        await this.handleSyncPull(res, principal, pullMatch.graphSpaceId, parsedUrl);
        return;
      }

      const subscribeMatch = this.matchPath(parsedUrl.pathname, "sync:subscribe");
      if (req.method === "GET" && subscribeMatch) {
        await this.handleSyncSubscribe(req, res, principal, subscribeMatch.graphSpaceId, parsedUrl);
        return;
      }

      this.writeJson(res, 404, {
        status: "error",
        category: "NOT_FOUND",
        reasonCode: "TRANSPORT.ROUTE_NOT_FOUND"
      });
    } catch {
      this.writeJson(res, 404, {
        status: "error",
        category: "NOT_FOUND",
        reasonCode: "TRANSPORT.UNAVAILABLE"
      });
    }
  }

  private async handleSubmit(
    res: ServerResponse,
    principal: PrincipalContext,
    graphSpaceId: string,
    req: IncomingMessage
  ): Promise<void> {
    const command = (await readJsonBody(req)) as Command;
    const submitted = this.gateway.submit(graphSpaceId, principal, command, command?.idempotencyKey);
    void submitted.ackTransport;
    const final = await submitted.final;
    if (this.submitResponseDelayMs > 0) {
      await sleep(this.submitResponseDelayMs);
    }
    this.writeJson(res, 200, final);
  }

  private async handleSyncPull(
    res: ServerResponse,
    principal: PrincipalContext,
    graphSpaceId: string,
    parsedUrl: URL
  ): Promise<void> {
    const fromCursorVisible = parsePositiveInt(parsedUrl.searchParams.get("from"), 0) ?? 0;
    const limitTx = parsePositiveInt(parsedUrl.searchParams.get("limitTx"));
    const limitBytes = parsePositiveInt(parsedUrl.searchParams.get("limitBytes"));

    const pulled = await this.gateway.syncPull(graphSpaceId, principal, fromCursorVisible, compactOptions({ limitTx, limitBytes }));
    this.writeJson(res, 200, pulled);
  }

  private async handleSyncSubscribe(
    req: IncomingMessage,
    res: ServerResponse,
    principal: PrincipalContext,
    graphSpaceId: string,
    parsedUrl: URL
  ): Promise<void> {
    const fromCursorVisible = parsePositiveInt(parsedUrl.searchParams.get("from"), 0) ?? 0;
    const heartbeatEveryMs = parsePositiveInt(parsedUrl.searchParams.get("heartbeatMs"));

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });

    const iterator = this.gateway
      .syncSubscribe(graphSpaceId, principal, fromCursorVisible, compactOptions({ heartbeatEveryMs }))
      [Symbol.asyncIterator]();

    const stop = async (): Promise<void> => {
      try {
        await iterator.return?.();
      } catch {
        // best-effort close
      }
      if (!res.writableEnded) {
        res.end();
      }
    };

    req.on("close", () => {
      void stop();
    });

    while (!res.writableEnded) {
      const { value, done } = await iterator.next();
      if (done) break;
      await writeSseFrame(res, "sync", value);
    }

    await stop();
  }

  private writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    if (res.writableEnded) return;
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  }

  private parsePrincipal(req: IncomingMessage): PrincipalContext | null {
    const raw = req.headers[this.principalHeaderName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed)) return null;
    return { principalId: trimmed };
  }

  private matchPath(pathname: string, action: "commands:submit" | "sync:pull" | "sync:subscribe"): { graphSpaceId: string } | null {
    const match = /^\/v1\/([^/]+)\/(commands:submit|sync:pull|sync:subscribe)$/.exec(pathname);
    if (!match) return null;
    const graphSpaceId = decodeURIComponent(match[1]!);
    const matchedAction = match[2]!;
    if (matchedAction !== action) return null;
    if (graphSpaceId !== this.graphSpaceId) return null;
    return { graphSpaceId };
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += typeof chunk === "string" ? chunk : String(chunk);
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function writeSseFrame(res: ServerResponse, event: string, payload: unknown): Promise<void> {
  const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  if (res.write(body)) return;
  await once(res, "drain");
}

function parsePositiveInt(value: string | null, fallback?: number): number | undefined {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactOptions<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
}

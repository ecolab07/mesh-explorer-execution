#!/usr/bin/env node

const GRAPH_SPACE_ID = "notes-app-shared-space-v1";

type Args = Record<string, string>;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const baseUrl = args.baseUrl ?? "http://127.0.0.1:8080";
  const principal = args.principal;

  if (!command) {
    process.stdout.write("usage: mesh-app <command> [--baseUrl ...] --principal <id>\n");
    return;
  }

  if (command === "create-note") {
    const result = await fetchJson(`${baseUrl}/notes`, {
      method: "POST",
      headers: principalHeaders(principal),
      body: JSON.stringify({ title: args.title ?? "", body: args.body ?? "" })
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "list-notes") {
    const result = await fetchJson(`${baseUrl}/notes`, {
      method: "GET",
      headers: principalHeaders(principal)
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "delete-note") {
    const result = await fetchJson(`${baseUrl}/notes/${encodeURIComponent(args.id ?? "")}`, {
      method: "DELETE",
      headers: principalHeaders(principal)
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "watch") {
    await watch(baseUrl, principal);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

async function watch(baseUrl: string, principal: string): Promise<void> {
  let from = 0;
  while (true) {
    const response = await fetch(`${baseUrl}/v1/${encodeURIComponent(GRAPH_SPACE_ID)}/sync:subscribe?from=${from}`, {
      headers: principalHeaders(principal)
    });
    if (!response.ok || !response.body) {
      await wait(100);
      continue;
    }

    for await (const frame of parseSse(response.body)) {
      process.stdout.write(`${JSON.stringify(frame)}\n`);
      if (frame.kind === "cursor" && typeof frame.cursorVisible === "number") {
        from = frame.cursorVisible;
      }
    }
  }
}

async function *parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<{ kind?: string; cursorVisible?: number }> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx < 0) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!data) continue;
      yield JSON.parse(data) as { kind?: string; cursorVisible?: number };
    }
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  return response.json();
}

function parseArgs(entries: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < entries.length; i += 1) {
    const token = entries[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = entries[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function principalHeaders(principal: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-mesh-principal": principal
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();

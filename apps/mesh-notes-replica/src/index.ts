import { promises as fs } from "node:fs";

export type NoteState = { id: string; title: string; body: string; deleted?: boolean };

type NoteEvent = {
  type: "note.created" | "note.updated" | "note.deleted";
  noteId: string;
  title?: string;
  body?: string;
};

type SyncFrame =
  | { kind: "txBundles"; txBundlesVisible: Array<{ txBundle: { graphEvents: unknown[] } }> }
  | { kind: "cursor"; cursorVisible: number }
  | { kind: "heartbeat"; cursorVisible: number };

export interface StartReplicaOptions {
  baseUrl: string;
  graphSpaceId?: string;
  principal: string;
  fromCursor?: number;
  cursorFile?: string;
  pollIntervalMs?: number;
}

export interface ReplicaHandle {
  stopReplica: () => Promise<void>;
  getState: () => NoteState[];
  getCursor: () => number;
}

const GRAPH_SPACE_ID = "notes-app-shared-space-v1";

export async function startReplica(options: StartReplicaOptions): Promise<ReplicaHandle> {
  const graphSpaceId = options.graphSpaceId ?? GRAPH_SPACE_ID;
  let cursor = options.fromCursor ?? (await readCursorFile(options.cursorFile));
  const state = new Map<string, NoteState>();
  const seenEventKeys = new Set<string>();
  const stopController = new AbortController();

  cursor = await bootstrapState(options.baseUrl, graphSpaceId, options.principal, state, seenEventKeys, cursor);
  await persistCursor(options.cursorFile, cursor);
  let sseAborter: AbortController | null = null;

  const pollLoop = async (): Promise<void> => {
    while (!stopController.signal.aborted) {
      try {
        const next = await pollFromCursor(options.baseUrl, graphSpaceId, options.principal, cursor);
        if (next.cursorAfter !== cursor) {
          applyGraphEvents(state, seenEventKeys, next.graph);
          cursor = next.cursorAfter;
          await persistCursor(options.cursorFile, cursor);
        }
      } catch {
        // source unavailable; poll remains source of truth once reachable again
      }
      await wait(options.pollIntervalMs ?? 40);
    }
  };

  const sseLoop = async (): Promise<void> => {
    while (!stopController.signal.aborted) {
      try {
        sseAborter = new AbortController();
        const response = await fetch(
          `${options.baseUrl}/v1/${encodeURIComponent(graphSpaceId)}/sync:subscribe?from=${cursor}`,
          {
            method: "GET",
            headers: { "x-mesh-principal": options.principal },
            signal: sseAborter.signal
          }
        );
        if (!response.ok || !response.body) {
          await wait(50);
          continue;
        }

        for await (const frame of parseSseFrames(response.body)) {
          if (stopController.signal.aborted) break;
          if (frame.kind === "cursor") {
            if (frame.cursorVisible > cursor) {
              cursor = frame.cursorVisible;
              await persistCursor(options.cursorFile, cursor);
            }
          }
          if (frame.kind === "txBundles") {
            for (const bundle of frame.txBundlesVisible) {
              applyGraphEvents(state, seenEventKeys, bundle.txBundle.graphEvents);
            }
          }
        }
      } catch {
        await wait(50);
      }
    }
  };

  const pollPromise = pollLoop();
  const ssePromise = sseLoop();

  return {
    stopReplica: async () => {
      stopController.abort();
      sseAborter?.abort();
      await Promise.allSettled([pollPromise, ssePromise]);
      await persistCursor(options.cursorFile, cursor);
    },
    getState: () => Array.from(state.values()).filter((note) => !note.deleted),
    getCursor: () => cursor
  };
}

async function pollFromCursor(baseUrl: string, graphSpaceId: string, principal: string, cursor: number): Promise<{ graph: unknown[]; cursorAfter: number }> {
  const response = await fetch(
    `${baseUrl}/v1/${encodeURIComponent(graphSpaceId)}/sync:pull?from=${cursor}&limitTx=64&limitBytes=131072`,
    {
      headers: { "x-mesh-principal": principal }
    }
  );
  if (!response.ok) {
    return { graph: [], cursorAfter: cursor };
  }
  const body = (await response.json()) as {
    txBundlesVisible?: Array<{ txBundle?: { graphEvents?: unknown[] } }>;
    cursorAfterVisible?: number;
  };
  const graph = (body.txBundlesVisible ?? []).flatMap((bundle) => bundle.txBundle?.graphEvents ?? []);
  return {
    graph,
    cursorAfter: body.cursorAfterVisible ?? cursor
  };
}

async function bootstrapState(
  baseUrl: string,
  graphSpaceId: string,
  principal: string,
  state: Map<string, NoteState>,
  seen: Set<string>,
  minimumCursor: number
): Promise<number> {
  let cursor = 0;
  while (true) {
    const next = await pollFromCursor(baseUrl, graphSpaceId, principal, cursor);
    applyGraphEvents(state, seen, next.graph);
    if (next.cursorAfter === cursor) {
      break;
    }
    cursor = next.cursorAfter;
  }
  return Math.max(cursor, minimumCursor);
}

function applyGraphEvents(state: Map<string, NoteState>, seen: Set<string>, events: unknown[]): void {
  for (const raw of events) {
    const event = raw as NoteEvent;
    if (!event || typeof event.noteId !== "string" || typeof event.type !== "string") continue;
    const key = `${event.type}:${event.noteId}:${event.title ?? ""}:${event.body ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (event.type === "note.created") {
      state.set(event.noteId, { id: event.noteId, title: event.title ?? "", body: event.body ?? "", deleted: false });
      continue;
    }
    if (event.type === "note.updated") {
      const existing = state.get(event.noteId);
      if (!existing) continue;
      state.set(event.noteId, { ...existing, title: event.title ?? existing.title, body: event.body ?? existing.body });
      continue;
    }
    if (event.type === "note.deleted") {
      const existing = state.get(event.noteId);
      if (!existing) continue;
      state.set(event.noteId, { ...existing, deleted: true });
    }
  }
}

async function *parseSseFrames(body: ReadableStream<Uint8Array>): AsyncIterable<SyncFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const splitIndex = buffer.indexOf("\n\n");
      if (splitIndex < 0) break;
      const frameRaw = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const dataLine = frameRaw
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine) as SyncFrame;
      yield parsed;
    }
  }
}

async function readCursorFile(filePath?: string): Promise<number> {
  if (!filePath) return 0;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function persistCursor(filePath: string | undefined, cursor: number): Promise<void> {
  if (!filePath) return;
  await fs.writeFile(filePath, String(cursor), "utf8");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileBackedLocalEventStore } from "@mesh/eventstore-local";
import { KernelMinimalImpl } from "@mesh/kernel-minimal";
import { SyncHttpReferenceServer } from "@mesh/sync-http";
const GRAPH_SPACE_ID = "notes-app-shared-space-v1";
const PRINCIPAL_HEADER = "x-mesh-principal";
async function loadLocalSyncGatewayCtor() {
    const gatewayModuleHref = pathToFileURL(join(process.cwd(), "packages/sync-local/src/internal/transportGateway.ts")).href;
    const loaded = (await import(gatewayModuleHref));
    return loaded.LocalSyncGateway;
}
export async function startMeshNotesServer(options) {
    await fs.mkdir(options.storageDir, { recursive: true });
    const graphSpaceId = options.graphSpaceId ?? GRAPH_SPACE_ID;
    const store = new FileBackedLocalEventStore(join(options.storageDir, "notes-eventstore.json"));
    const kernel = new KernelMinimalImpl(store);
    const Gateway = await loadLocalSyncGatewayCtor();
    const gateway = new Gateway(store, { graphSpaceId, executeCommand: (command) => kernel.execute(command) });
    const syncServer = new SyncHttpReferenceServer({ graphSpaceId, gateway });
    const syncListen = await syncServer.listen(0, "127.0.0.1");
    const appServer = createServer((req, res) => {
        void handleRequest(req, res, {
            gateway,
            graphSpaceId,
            syncBaseUrl: syncListen.url
        });
    });
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    appServer.listen(port, host);
    await once(appServer, "listening");
    const address = appServer.address();
    if (!address || typeof address === "string") {
        throw new Error("Unable to bind mesh notes server");
    }
    return {
        url: `http://${host}:${address.port}`,
        port: address.port,
        close: async () => {
            appServer.close();
            await once(appServer, "close");
            await syncServer.close();
        }
    };
}
async function handleRequest(req, res, deps) {
    const requestUrl = new URL(req.url ?? "/", "http://notes.local");
    const principal = parsePrincipal(req);
    if (!principal) {
        writeJson(res, 401, { status: "rejected", category: "PERMISSION", reasonCode: "AUTH.PRINCIPAL_REQUIRED" });
        return;
    }
    if (requestUrl.pathname.startsWith("/v1/")) {
        await proxyToSyncServer(req, res, `${deps.syncBaseUrl}${requestUrl.pathname}${requestUrl.search}`);
        return;
    }
    if (req.method === "POST" && requestUrl.pathname === "/notes") {
        const body = (await readJsonBody(req));
        const title = typeof body.title === "string" ? body.title : "";
        const content = typeof body.body === "string" ? body.body : "";
        const noteId = randomUUID();
        const outcome = await submitNoteCommand(deps.gateway, deps.graphSpaceId, principal, {
            type: "note.created",
            noteId,
            title,
            body: content,
            _acl: maskForOtherPrincipal(principal.principalId)
        });
        writeJson(res, 200, { noteId, outcome });
        return;
    }
    const patchMatch = /^\/notes\/([^/]+)$/.exec(requestUrl.pathname);
    if (req.method === "PATCH" && patchMatch) {
        const noteId = decodeURIComponent(patchMatch[1]);
        const body = (await readJsonBody(req));
        const title = typeof body.title === "string" ? body.title : undefined;
        const content = typeof body.body === "string" ? body.body : undefined;
        const outcome = await submitNoteCommand(deps.gateway, deps.graphSpaceId, principal, {
            type: "note.updated",
            noteId,
            title,
            body: content,
            _acl: maskForOtherPrincipal(principal.principalId)
        });
        writeJson(res, 200, { noteId, outcome });
        return;
    }
    if (req.method === "DELETE" && patchMatch) {
        const noteId = decodeURIComponent(patchMatch[1]);
        const outcome = await submitNoteCommand(deps.gateway, deps.graphSpaceId, principal, {
            type: "note.deleted",
            noteId,
            _acl: maskForOtherPrincipal(principal.principalId)
        });
        writeJson(res, 200, { noteId, outcome });
        return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/notes") {
        const state = await readVisibleNotes(deps.gateway, deps.graphSpaceId, principal);
        writeJson(res, 200, { notes: Array.from(state.values()).filter((note) => !note.deleted) });
        return;
    }
    writeJson(res, 404, { status: "error", category: "NOT_FOUND", reasonCode: "NOT_FOUND.GENERIC" });
}
async function readVisibleNotes(gateway, graphSpaceId, principal) {
    const notes = new Map();
    let cursor = 0;
    while (true) {
        const pulled = await gateway.syncPull(graphSpaceId, principal, cursor, { limitTx: 32, limitBytes: 128 * 1024 });
        for (const bundle of pulled.txBundlesVisible) {
            for (const raw of bundle.txBundle.graphEvents) {
                applyEvent(notes, raw);
            }
        }
        if (pulled.cursorAfterVisible === cursor) {
            break;
        }
        cursor = pulled.cursorAfterVisible;
    }
    return notes;
}
function applyEvent(state, event) {
    if (!event || typeof event !== "object" || typeof event.noteId !== "string")
        return;
    if (event.type === "note.created") {
        state.set(event.noteId, { id: event.noteId, title: event.title ?? "", body: event.body ?? "", deleted: false });
        return;
    }
    if (event.type === "note.updated") {
        const existing = state.get(event.noteId);
        if (!existing)
            return;
        state.set(event.noteId, {
            ...existing,
            title: event.title ?? existing.title,
            body: event.body ?? existing.body
        });
        return;
    }
    if (event.type === "note.deleted") {
        const existing = state.get(event.noteId);
        if (!existing)
            return;
        state.set(event.noteId, { ...existing, deleted: true });
    }
}
async function submitNoteCommand(gateway, graphSpaceId, principal, payload) {
    const command = {
        graphSpaceId,
        commandId: randomUUID(),
        actorId: principal.principalId,
        idempotencyKey: randomUUID(),
        payload
    };
    const submitted = gateway.submit(graphSpaceId, principal, command, command.idempotencyKey);
    return submitted.final;
}
function parsePrincipal(req) {
    const raw = req.headers[PRINCIPAL_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return { principalId: trimmed };
}
function maskForOtherPrincipal(principal) {
    if (principal === "alice")
        return { bob: "mask" };
    if (principal === "bob")
        return { alice: "mask" };
    return {};
}
async function readJsonBody(req) {
    let raw = "";
    for await (const chunk of req) {
        raw += typeof chunk === "string" ? chunk : String(chunk);
    }
    if (!raw)
        return {};
    return JSON.parse(raw);
}
async function proxyToSyncServer(req, res, targetUrl) {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRawBody(req);
    const proxied = await fetch(targetUrl, {
        method: req.method,
        headers: copyHeaders(req.headers),
        body
    });
    res.statusCode = proxied.status;
    for (const [header, value] of proxied.headers.entries()) {
        res.setHeader(header, value);
    }
    if (!proxied.body) {
        res.end();
        return;
    }
    const reader = proxied.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        if (!res.write(Buffer.from(value))) {
            await once(res, "drain");
        }
    }
    res.end();
}
async function readRawBody(req) {
    let raw = "";
    for await (const chunk of req) {
        raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    }
    return raw;
}
function copyHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string")
            out[key] = value;
        if (Array.isArray(value))
            out[key] = value.join(",");
    }
    return out;
}
function writeJson(res, status, payload) {
    if (res.writableEnded)
        return;
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const storageDir = process.env.MESH_NOTES_STORAGE_DIR ?? ".mesh-notes-data";
    const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8080;
    startMeshNotesServer({ storageDir, port }).then((server) => {
        process.stdout.write(`mesh-notes-server listening on ${server.url}\n`);
    });
}

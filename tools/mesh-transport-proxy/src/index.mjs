import { MeshTransportProxy } from "./proxy.mjs";

const host = process.env.MESH_TRANSPORT_PROXY_HOST ?? "127.0.0.1";
const port = Number(process.env.MESH_TRANSPORT_PROXY_PORT ?? "8091");
const upstreamBaseUrl = process.env.MESH_TRANSPORT_PROXY_UPSTREAM ?? "http://127.0.0.1:8090";
const closeDelayMs = Number(process.env.MESH_TRANSPORT_PROXY_CLOSE_DELAY_MS ?? "200");

const proxy = new MeshTransportProxy({
  host,
  port,
  upstreamBaseUrl,
  closeDelayMs
});

const shutdown = async (signal) => {
  console.info(`[transport-proxy] received ${signal}, shutting down`);
  await proxy.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void proxy.listen();

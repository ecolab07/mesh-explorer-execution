import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMeshGraphServer, type MeshGraphServerHandle } from "../src/index";

describe("mesh graph server root route", () => {
  const startedServers: MeshGraphServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(startedServers.splice(0).map((server) => server.close()));
  });

  it("allows unauthenticated GET / and keeps API endpoints protected", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "mesh-graph-server-test-"));
    const server = await startMeshGraphServer({ storageDir, port: 0 });
    startedServers.push(server);

    const rootResponse = await fetch(`${server.url}/`);
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("content-type")).toContain("text/plain");
    const rootBody = await rootResponse.text();
    expect(rootBody).toContain("mesh-graph-server API endpoint");
    expect(rootBody).toContain("x-mesh-principal");

    const protectedResponse = await fetch(`${server.url}/graph/view`);
    expect(protectedResponse.status).toBe(401);
    await expect(protectedResponse.json()).resolves.toMatchObject({
      status: "rejected",
      category: "PERMISSION",
      reasonCode: "AUTH.PRINCIPAL_REQUIRED"
    });
  });
});

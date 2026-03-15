import { afterEach, describe, expect, it } from "vitest";
import {
  dumpReplicaState,
  seedCanonicalEvents,
  startReplica,
  startServer,
  type ReplicaHarness,
  type ServerHarness
} from "../src/index.js";

async function waitFor(check: () => boolean, timeoutMs = 5_000, intervalMs = 50): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe("sync runtime harness", () => {
  let server: ServerHarness | null = null;
  let replica: ReplicaHarness | null = null;

  afterEach(async () => {
    if (replica) {
      await replica.stop();
      replica = null;
    }
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("boots server, seeds canonical events, and allows one replica to connect", async () => {
    server = await startServer("alice");
    await seedCanonicalEvents(server);

    replica = await startReplica(server, "alice");

    await waitFor(() => replica?.handle.getCursor() !== undefined && replica.handle.getCursor() > 0);

    expect(replica.handle.getCursor()).toBeGreaterThan(0);
    expect(replica.handle.getState().length).toBeGreaterThan(0);
  });

  it("produces byte-identical dumps for identical in-memory state", async () => {
    server = await startServer("alice");
    await seedCanonicalEvents(server);

    replica = await startReplica(server, "alice");
    await waitFor(() => (replica?.handle.getState().length ?? 0) >= 2);

    const dump1 = dumpReplicaState(replica);
    const dump2 = dumpReplicaState(replica);

    expect(dump1).toEqual(dump2);
  });

  it("produces byte-identical dumps after replica restart on identical canonical state", async () => {
    server = await startServer("alice");
    await seedCanonicalEvents(server);

    replica = await startReplica(server, "alice");
    await waitFor(() => (replica?.handle.getState().length ?? 0) >= 2);

    const initialDump = dumpReplicaState(replica);

    await replica.stop();
    replica = null;

    replica = await startReplica(server, "alice");
    await waitFor(() => (replica?.handle.getState().length ?? 0) >= 2);

    const restartDump = dumpReplicaState(replica);

    expect(restartDump).toEqual(initialDump);
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Command } from "@mesh/shared";
import { createRuntimeLocal } from "../src/index.js";

const roots: string[] = [];

async function makeRootDir(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mesh-runtime-local-${prefix}-`));
  roots.push(root);
  return root;
}

function makeCommand(graphSpaceId: string, idx: number): Command {
  return {
    graphSpaceId,
    commandId: `cmd-${idx}`,
    actorId: "actor-a",
    idempotencyKey: `idem-${idx}`,
    payload: { idx }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("@mesh/runtime-local", () => {
  it("restart preserves view and head", async () => {
    const rootDir = await makeRootDir("restart");
    const config = {
      rootDir,
      graphSpaceId: "space-restart",
      principalId: "principal-restart"
    };

    const runtime1 = await createRuntimeLocal(config);
    await runtime1.start();
    await runtime1.write(makeCommand(config.graphSpaceId, 1));
    await runtime1.write(makeCommand(config.graphSpaceId, 2));
    const state1 = await runtime1.read();
    await runtime1.stop();

    const runtime2 = await createRuntimeLocal(config);
    await runtime2.start();
    const state2 = await runtime2.read();
    await runtime2.stop();

    expect(state2.head.tx).toBe(state1.head.tx);
    expect(state2.view).toEqual(state1.view);
  });

  it("read() is pure and does not create snapshots", async () => {
    const rootDir = await makeRootDir("read-pure");
    const config = {
      rootDir,
      graphSpaceId: "space-pure",
      principalId: "principal-pure",
      snapshotPolicy: { minTx: 1 }
    };

    const runtime = await createRuntimeLocal(config);
    await runtime.start();
    await runtime.write(makeCommand(config.graphSpaceId, 1));

    const snapshotPath = path.join(rootDir, "snapshots", "snapshots.json");
    const beforeRead = await fs.readFile(snapshotPath, "utf8");
    await runtime.read();
    const afterRead = await fs.readFile(snapshotPath, "utf8");
    await runtime.stop();

    expect(afterRead).toBe(beforeRead);
  });

  it("start() writes snapshot when policy is enabled", async () => {
    const rootDir = await makeRootDir("start-snapshot");
    const graphSpaceId = "space-snapshot";

    const seedRuntime = await createRuntimeLocal({
      rootDir,
      graphSpaceId,
      principalId: "principal-snapshot"
    });
    await seedRuntime.start();
    await seedRuntime.write(makeCommand(graphSpaceId, 1));
    await seedRuntime.stop();

    const runtime = await createRuntimeLocal({
      rootDir,
      graphSpaceId,
      principalId: "principal-snapshot",
      snapshotPolicy: { minTx: 1 }
    });
    await runtime.start();

    const snapshotPath = path.join(rootDir, "snapshots", "snapshots.json");
    const snapshotRaw = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      snapshots: Array<{ cursorAt: number; graphSpaceId: string; principalId: string }>;
    };

    await runtime.stop();

    const scoped = snapshotRaw.snapshots.filter((snap) => snap.graphSpaceId === graphSpaceId && snap.principalId === "principal-snapshot");
    expect(scoped.length).toBeGreaterThanOrEqual(1);
    expect(scoped.at(-1)?.cursorAt).toBeGreaterThanOrEqual(1);
  });
});

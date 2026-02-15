import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Command } from "@mesh/shared";
import { createRuntimeLocal } from "../src/index.js";

function makeRootDir(name: string): string {
  return path.resolve(
    process.cwd(),
    ".mesh-test-tmp",
    `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
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

describe("@mesh/runtime-local snapshot policy", () => {
  it("applies maintenance during start() and never writes snapshots during read()", async () => {
    const rootDir = makeRootDir("runtime-snapshot-policy");
    const graphSpaceId = "space-snapshot-hardening";
    const principalId = "principal-snapshot-hardening";
    await mkdir(rootDir, { recursive: true });

    try {
      const seed = await createRuntimeLocal({
        rootDir,
        graphSpaceId,
        principalId,
        snapshotPolicy: { minTx: 1 }
      });

      await seed.start();
      await seed.write(makeCommand(graphSpaceId, 1));
      await seed.write(makeCommand(graphSpaceId, 2));
      await seed.write(makeCommand(graphSpaceId, 3));
      await seed.stop();

      const runtime = await createRuntimeLocal({
        rootDir,
        graphSpaceId,
        principalId,
        snapshotPolicy: { minTx: 1 }
      });
      await runtime.start();

      const snapshotPath = path.join(rootDir, "snapshots", "snapshots.json");
      const beforeReadStat = await stat(snapshotPath);
      const beforeReadContent = await readFile(snapshotPath, "utf8");

      await runtime.read();

      const afterReadStat = await stat(snapshotPath);
      const afterReadContent = await readFile(snapshotPath, "utf8");
      await runtime.stop();

      expect(beforeReadStat.size).toBeGreaterThan(0);
      expect(afterReadStat.mtimeMs).toBe(beforeReadStat.mtimeMs);
      expect(afterReadContent).toBe(beforeReadContent);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

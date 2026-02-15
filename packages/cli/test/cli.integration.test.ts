import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunResult = { code: number | null; stdout: string; stderr: string };

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const cliEntrypoint = path.resolve(testDir, "../dist/bin/mesh.js");
let buildPromise: Promise<void> | null = null;

async function ensureCliBuilt(): Promise<void> {
  if (buildPromise) return buildPromise;

  buildPromise = access(cliEntrypoint).catch(() => {
    const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const build = spawnSync(pnpmCmd, ["-r", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8"
    });

    if (build.status !== 0) {
      const stdout = typeof build.stdout === "string" ? build.stdout : "";
      const stderr = typeof build.stderr === "string" ? build.stderr : "";
      throw new Error(`Missing built CLI entrypoint at ${cliEntrypoint}, and auto-build failed. ${stdout}\n${stderr}`.trim());
    }
  });

  return buildPromise;
}

async function runMesh(args: string[], cwd?: string): Promise<RunResult> {
  await ensureCliBuilt();

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function makeRootDir(name: string): string {
  return path.resolve(
    process.cwd(),
    ".mesh-test-tmp",
    `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe("@mesh/cli integration", () => {
  it(
    "persists committed writes across restart via CLI",
    async () => {
      const rootDir = makeRootDir("cli-restart");
      await mkdir(rootDir, { recursive: true });

      try {
        const write = await runMesh([
          "write",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-restart",
          "--principalId",
          "principal-cli-restart",
          "--actorId",
          "actor-a",
          "--commandId",
          "cmd-1",
          "--idempotencyKey",
          "idem-1",
          "--payloadJson",
          '{"hello":"world"}'
        ]);

        expect(write.code).toBe(0);
        expect(write.stderr).toBe("");
        const writeOutcome = JSON.parse(write.stdout) as { status: string };
        expect(writeOutcome.status).toBe("committed");

        const firstRead = await runMesh([
          "read",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-restart",
          "--principalId",
          "principal-cli-restart"
        ]);
        expect(firstRead.code).toBe(0);
        const firstState = JSON.parse(firstRead.stdout) as { head: { tx: string }; view: unknown };

        const secondRead = await runMesh([
          "read",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-restart",
          "--principalId",
          "principal-cli-restart"
        ]);
        expect(secondRead.code).toBe(0);
        const secondState = JSON.parse(secondRead.stdout) as { head: { tx: string }; view: unknown };

        expect(secondState.head.tx).toBe(firstState.head.tx);
        expect(secondState.view).toEqual(firstState.view);
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    },
    20000
  );

  it(
    "maps write outcomes and input errors to stable exit codes",
    async () => {
      const rootDir = makeRootDir("cli-exit-codes");
      await mkdir(rootDir, { recursive: true });

      try {
        const rejected = await runMesh([
          "write",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-exit",
          "--principalId",
          "principal-cli-exit",
          "--actorId",
          "actor-a",
          "--commandId",
          "cmd-rejected",
          "--idempotencyKey",
          "idem-rejected",
          "--payloadJson",
          "null"
        ]);
        expect(rejected.code).toBe(2);
        expect(rejected.stderr).toBe("");
        const rejectedOutcome = JSON.parse(rejected.stdout) as { status: string };
        expect(rejectedOutcome.status).toBe("rejected");

        const missingFlag = await runMesh([
          "write",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-exit",
          "--principalId",
          "principal-cli-exit",
          "--actorId",
          "actor-a",
          "--commandId",
          "cmd-missing",
          "--idempotencyKey",
          "idem-missing"
        ]);
        expect(missingFlag.code).toBe(1);
        expect(missingFlag.stderr).toContain("Missing required flag --payloadJson");

        const malformedJson = await runMesh([
          "write",
          "--rootDir",
          rootDir,
          "--graphSpaceId",
          "space-cli-exit",
          "--principalId",
          "principal-cli-exit",
          "--actorId",
          "actor-a",
          "--commandId",
          "cmd-bad-json",
          "--idempotencyKey",
          "idem-bad-json",
          "--payloadJson",
          "{"
        ]);
        expect(malformedJson.code).toBe(1);
        expect(malformedJson.stderr.length).toBeGreaterThan(0);
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    },
    20000
  );

  it("runs --help quickly as a cold-start guardrail", async () => {
    const startedAt = Date.now();
    const help = await runMesh(["--help"]);
    const elapsedMs = Date.now() - startedAt;

    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: mesh <command>");
    expect(elapsedMs).toBeLessThan(5000);
  });
});

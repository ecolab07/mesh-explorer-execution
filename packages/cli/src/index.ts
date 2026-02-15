import { access } from "node:fs/promises";
import path from "node:path";
import { createRuntimeLocal } from "@mesh/runtime-local";
import type { Command } from "@mesh/shared";
import { buildRuntimeConfig, parseArgs } from "./args.js";

const HELP_TEXT = `Usage: mesh <command> [options]

Commands:
  write    Write one command payload to local runtime.
  read     Read default runtime view.
  status   Print CLI/runtime status.
  help     Show help.
  version  Show version.

Common options:
  --rootDir <path>
  --graphSpaceId <id>
  --principalId <id>

Write options:
  --actorId <id>
  --commandId <id>
  --idempotencyKey <key>
  --payloadJson <json>
  --requireBaseRevision <json>

Runtime tuning options:
  --snapshotMinTx <n>
  --snapshotIntervalMs <n>
  --replayMaxTx <n>
  --replayMaxMs <n>
`;

function getRequired(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

async function runWrite(flags: Record<string, string>): Promise<number> {
  const runtime = await createRuntimeLocal(buildRuntimeConfig(flags));

  try {
    await runtime.start();
    const payload = JSON.parse(getRequired(flags, "payloadJson")) as Record<string, unknown>;
    const requireBaseRevisionRaw = flags.requireBaseRevision;

    const command: Command = {
      graphSpaceId: getRequired(flags, "graphSpaceId"),
      actorId: getRequired(flags, "actorId"),
      commandId: getRequired(flags, "commandId"),
      idempotencyKey: getRequired(flags, "idempotencyKey"),
      payload,
      requireBaseRevision:
        requireBaseRevisionRaw === undefined
          ? undefined
          : (JSON.parse(requireBaseRevisionRaw) as unknown as Command["requireBaseRevision"])
    };

    const outcome = await runtime.write(command);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    return outcome.status === "committed" ? 0 : 2;
  } finally {
    await runtime.stop();
  }
}

async function runRead(flags: Record<string, string>): Promise<number> {
  const runtime = await createRuntimeLocal(buildRuntimeConfig(flags));

  try {
    await runtime.start();
    const state = await runtime.read();
    process.stdout.write(`${JSON.stringify({ head: state.head, view: state.view })}\n`);
    return 0;
  } finally {
    await runtime.stop();
  }
}

async function runStatus(flags: Record<string, string>): Promise<number> {
  if (!flags.rootDir) {
    process.stdout.write(`${JSON.stringify({ ok: true, started: false })}\n`);
    return 0;
  }

  const eventstorePath = path.join(flags.rootDir, "eventstore", "events.json");
  const snapshotsPath = path.join(flags.rootDir, "snapshots", "snapshots.json");

  const [eventstoreExists, snapshotsExists] = await Promise.all([
    exists(eventstorePath),
    exists(snapshotsPath)
  ]);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      started: false,
      rootDir: flags.rootDir,
      files: {
        eventstore: { path: eventstorePath, exists: eventstoreExists },
        snapshots: { path: snapshotsPath, exists: snapshotsExists }
      }
    })}\n`
  );

  return 0;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
}

function printVersion(): void {
  process.stdout.write(`${JSON.stringify({ name: "@mesh/cli", version: "0.1.0" })}\n`);
}

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    const parsed = parseArgs(argv);

    if (parsed.command === "help") {
      printHelp();
      return 0;
    }

    if (parsed.command === "version") {
      printVersion();
      return 0;
    }

    if (parsed.command === "write") return await runWrite(parsed.flags);
    if (parsed.command === "read") return await runRead(parsed.flags);
    return await runStatus(parsed.flags);
  } catch (error) {
    printError(error);
    if (error instanceof Error && error.message.startsWith("Missing required flag")) {
      printHelp();
    }
    return 1;
  }
}

export { parseArgs, buildRuntimeConfig } from "./args.js";

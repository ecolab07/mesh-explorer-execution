export type CliCommandName = "write" | "read" | "status" | "help" | "version";

export type ParsedCli = {
  command: CliCommandName;
  flags: Record<string, string>;
};

export type ParsedRuntimeConfig = {
  rootDir: string;
  graphSpaceId: string;
  principalId: string;
  snapshotPolicy?: { minTx?: number; intervalMs?: number };
  replayBudget?: { maxTx?: number; maxMs?: number };
};

export function parseArgs(argv: string[]): ParsedCli {
  const [rawCommand, ...rest] = argv;
  const normalized = rawCommand ?? "help";

  if (normalized === "--help" || normalized === "-h") {
    return { command: "help", flags: {} };
  }

  if (normalized === "--version" || normalized === "-v") {
    return { command: "version", flags: {} };
  }

  if (!isCliCommand(normalized)) {
    throw new Error(`Unknown command: ${normalized}`);
  }

  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    return { command: "help", flags: {} };
  }

  if (rest.length === 1 && (rest[0] === "--version" || rest[0] === "-v")) {
    return { command: "version", flags: {} };
  }

  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    flags[token.slice(2)] = value;
    i += 1;
  }

  return {
    command: normalized,
    flags
  };
}

function isCliCommand(command: string): command is "write" | "read" | "status" {
  return command === "write" || command === "read" || command === "status";
}

function getRequired(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function getOptionalNumber(flags: Record<string, string>, key: string): number | undefined {
  const value = flags[key];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Flag --${key} must be a number`);
  }
  return parsed;
}

export function buildRuntimeConfig(flags: Record<string, string>): ParsedRuntimeConfig {
  const snapshotMinTx = getOptionalNumber(flags, "snapshotMinTx");
  const snapshotIntervalMs = getOptionalNumber(flags, "snapshotIntervalMs");
  const replayMaxTx = getOptionalNumber(flags, "replayMaxTx");
  const replayMaxMs = getOptionalNumber(flags, "replayMaxMs");

  return {
    rootDir: getRequired(flags, "rootDir"),
    graphSpaceId: getRequired(flags, "graphSpaceId"),
    principalId: getRequired(flags, "principalId"),
    snapshotPolicy:
      snapshotMinTx !== undefined || snapshotIntervalMs !== undefined
        ? {
            minTx: snapshotMinTx,
            intervalMs: snapshotIntervalMs
          }
        : undefined,
    replayBudget:
      replayMaxTx !== undefined || replayMaxMs !== undefined
        ? {
            maxTx: replayMaxTx,
            maxMs: replayMaxMs
          }
        : undefined
  };
}

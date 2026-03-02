import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const vitestExecutable = process.platform === "win32" ? "vitest.cmd" : "vitest";
const vitestCandidates = [
  resolve(scriptDir, "../node_modules/.bin", vitestExecutable),
  resolve(scriptDir, "../../../node_modules/.bin", vitestExecutable),
];
const vitestBin = vitestCandidates.find((candidate) => existsSync(candidate));

if (!vitestBin) {
  console.error(new Error(`Unable to locate ${vitestExecutable} in expected workspace locations.`));
  process.exit(1);
}

const env = {
  ...process.env,
  MESH_TX_VISIBILITY_POLICY: "acl",
};

const args = ["run", ...process.argv.slice(2)];
const quoteForCmd = (arg) => `"${arg.replaceAll('"', '""')}"`;
const result =
  process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec || "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          `"${[quoteForCmd(vitestBin), ...args.map(quoteForCmd)].join(" ")}"`,
        ],
        {
          stdio: "inherit",
          env,
          shell: false,
        },
      )
    : spawnSync(vitestBin, args, {
        stdio: "inherit",
        env,
        shell: false,
      });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}

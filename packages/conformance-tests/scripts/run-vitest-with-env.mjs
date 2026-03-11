import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const vitestCandidates = [
  resolve(scriptDir, "../node_modules/vitest/vitest.mjs"),
  resolve(scriptDir, "../../../node_modules/vitest/vitest.mjs")
];

const vitestEntry = vitestCandidates.find((candidate) => existsSync(candidate));
if (!vitestEntry) {
  console.error("Unable to locate vitest/vitest.mjs in expected workspace locations.");
  process.exit(1);
}

const env = {
  ...process.env,
  MESH_TX_VISIBILITY_POLICY: process.env.MESH_TX_VISIBILITY_POLICY ?? "acl"
};

const stdioMode = process.env.MESH_VITEST_STDIO === "pipe" ? "pipe" : "inherit";
const args = [vitestEntry, "run", ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  stdio: stdioMode,
  encoding: "utf8",
  env,
  shell: false
});

if (stdioMode === "pipe") {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}


if (result.status !== 0 || result.signal) {
  const details = [
    `[run-vitest-with-env] cwd=${process.cwd()}`,
    `[run-vitest-with-env] node=${process.execPath}`,
    `[run-vitest-with-env] vitestEntry=${vitestEntry}`,
    `[run-vitest-with-env] command=node ${args.join(" ")}`,
    `[run-vitest-with-env] stdio=${stdioMode}`,
    `[run-vitest-with-env] env.MESH_BACKEND=${env.MESH_BACKEND ?? "<unset>"}`,
    `[run-vitest-with-env] env.MESH_TX_VISIBILITY_POLICY=${env.MESH_TX_VISIBILITY_POLICY ?? "<unset>"}`,
    `[run-vitest-with-env] env.MESH_EVIDENCE_META_PATH=${env.MESH_EVIDENCE_META_PATH ?? "<unset>"}`,
    `[run-vitest-with-env] exitCode=${String(result.status)}`,
    `[run-vitest-with-env] signal=${String(result.signal)}`
  ].join("\n");
  console.error(details);
}

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

// scripts/run-vitest-with-env.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * On cherche vitest/vitest.mjs :
 * - soit dans le package local
 * - soit dans le root du monorepo
 */
const vitestCandidates = [
  resolve(scriptDir, "../node_modules/vitest/vitest.mjs"),
  resolve(scriptDir, "../../../node_modules/vitest/vitest.mjs"),
];

const vitestEntry = vitestCandidates.find((p) => existsSync(p));

if (!vitestEntry) {
  console.error("Unable to locate vitest/vitest.mjs in expected workspace locations.");
  process.exit(1);
}

const env = {
  ...process.env,
  MESH_TX_VISIBILITY_POLICY: "acl",
};

// node <vitest.mjs> run ...
const args = [
  vitestEntry,
  "run",
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env,
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
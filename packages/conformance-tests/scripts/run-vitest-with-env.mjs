import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vitestEntrypoint = require.resolve("vitest/vitest.mjs");
const env = {
  ...process.env,
  MESH_TX_VISIBILITY_POLICY: "acl",
};

const child = spawn(process.execPath, [vitestEntrypoint, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

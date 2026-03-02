import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const color = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function run(script) {
  const result = spawnSync("node", [script], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Check TODO
run("./scripts/check-no-todo.mjs");

// 2. Windows path guard
if (platform() === "win32") {
  const cwd = process.cwd();

  if (cwd.includes(" ")) {
    console.error("");
    console.error(color.red(color.bold("❌ Windows path contains spaces:")));
    console.error(color.yellow(`   ${cwd}`));
    console.error("");
    console.error(
      color.red("Vite module resolution breaks when path contains spaces.")
    );
    console.error("");
    console.error(
      color.cyan("Move the repository to a path without spaces, e.g.:")
    );
    console.error("");
    process.exit(1);
  }
}
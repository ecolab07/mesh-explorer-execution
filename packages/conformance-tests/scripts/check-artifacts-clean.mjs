import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function run(command) {
  execSync(command, { cwd: repoRoot, stdio: "inherit" });
}

try {
  run("pnpm --filter @mesh/conformance-tests test");
  // Runtime diagnostics are intentionally excluded: they contain non-deterministic metadata.
  run("git diff --exit-code -- artifacts/conformance-evidence.md artifacts/conformance-evidence.json");
} catch {
  console.error("Conformance artifacts are not up to date. Re-run tests and commit updated artifacts.");
  process.exit(1);
}

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const targetDir = new URL("../src", import.meta.url);
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile() || !fullPath.endsWith(".ts")) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("TODO")) {
        violations.push(`${fullPath}:${index + 1}:${line.trim()}`);
      }
    });
  }
}

const sourceDir = targetDir.pathname;
const sourceStats = await stat(sourceDir);
if (!sourceStats.isDirectory()) {
  throw new Error(`Expected directory not found: ${sourceDir}`);
}

await walk(sourceDir);

if (violations.length > 0) {
  console.error("Found TODO markers in packages/conformance-tests:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("No TODO markers found in packages/conformance-tests.");

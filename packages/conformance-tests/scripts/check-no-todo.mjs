import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const targetDir = new URL("../src", import.meta.url);
const violations = [];

const bannedPatterns = [
  { name: "TODO", regex: /TODO/ },
  { name: "FIXME", regex: /FIXME/ },
  { name: "assert(true)", regex: /\bassert\s*\(\s*true\s*\)/ },
  { name: "expect(true).toBe(true)", regex: /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/ }
];

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
      for (const pattern of bannedPatterns) {
        if (pattern.regex.test(line)) {
          violations.push(`${fullPath}:${index + 1}:${pattern.name}:${line.trim()}`);
        }
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
  console.error("Found banned markers in packages/conformance-tests:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("No banned markers found in packages/conformance-tests.");

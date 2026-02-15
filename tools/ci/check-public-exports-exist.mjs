#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(repoRoot, "contracts/v1/manifest.json");
const goldenDir = path.join(repoRoot, "contracts/v1/golden");

function pkgOutputName(name) {
  return name.replace(/^@/, "").replace(/\//g, "__");
}

function pkgDirFromName(name) {
  return path.join(repoRoot, "packages", name.replace("@mesh/", ""));
}

function collectStarExports(goldenText) {
  const exports = new Set();
  const re = /^export\s+\*\s+from\s+["'](\.\/[^"']+\.js)["'];?\s*$/gm;
  for (const match of goldenText.matchAll(re)) {
    exports.add(match[1]);
  }
  return [...exports].sort();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest)) {
    throw new Error("contracts/v1/manifest.json must contain an array");
  }

  const missing = [];

  for (const item of manifest) {
    if (item?.kind !== "public") continue;
    if (typeof item.name !== "string") {
      throw new Error(`Invalid public item in manifest: ${JSON.stringify(item)}`);
    }

    const pkgDir = pkgDirFromName(item.name);
    const distDir = path.join(pkgDir, "dist");
    const goldenPath = path.join(goldenDir, `${pkgOutputName(item.name)}.d.ts`);

    if (!(await exists(path.join(distDir, "index.js")))) {
      missing.push(path.relative(repoRoot, path.join(distDir, "index.js")));
    }

    if (!(await exists(path.join(distDir, "index.d.ts")))) {
      missing.push(path.relative(repoRoot, path.join(distDir, "index.d.ts")));
    }

    if (!(await exists(goldenPath))) {
      missing.push(path.relative(repoRoot, goldenPath));
      continue;
    }

    const goldenText = await fs.readFile(goldenPath, "utf8");
    const starExports = collectStarExports(goldenText);
    for (const exportPath of starExports) {
      const rel = exportPath.replace(/^\.\//, "");
      const distExportPath = path.join(distDir, rel);
      if (!(await exists(distExportPath))) {
        missing.push(path.relative(repoRoot, distExportPath));
      }
    }
  }

  if (missing.length > 0) {
    console.error("Public export artifact check failed. Missing files:");
    for (const file of [...new Set(missing)].sort()) {
      console.error(`- ${file}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Public export artifact check passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

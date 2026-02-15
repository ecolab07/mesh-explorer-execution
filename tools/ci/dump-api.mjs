#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.resolve(repoRoot, "contracts/v1/manifest.json");

function parseArgs(argv) {
  const options = { mode: "golden", skipBuild: false };
  for (const arg of argv) {
    if (arg === "--skip-build") options.skipBuild = true;
    else if (arg.startsWith("--mode=")) options.mode = arg.slice("--mode=".length);
  }
  if (options.mode !== "golden" && options.mode !== "generated") {
    throw new Error(`Invalid --mode, expected golden|generated but got: ${options.mode}`);
  }
  return options;
}

async function run(cmd, args, cwd = repoRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${cmd} ${args.join(" ")} (exit ${code ?? "null"})`));
    });
  });
}

function pkgDirFromName(name) {
  const shortName = name.replace("@mesh/", "");
  return path.resolve(repoRoot, "packages", shortName);
}

function normalizeDts(text) {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll(process.cwd().replaceAll("\\", "/"), "<REPO_ROOT>")
    .replace(/\/\/[#@] sourceMappingURL=.*$/gm, "")
    .replace(/\/\*\s*eslint[^*]*\*\//g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function pkgOutputName(name) {
  return name.replace(/^@/, "").replace(/\//g, "__");
}

function collectExportLines(text) {
  const lines = text.split("\n");
  const exports = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("export "));
  return exports;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("contracts/v1/manifest.json must be a non-empty array");
  }

  const outRoot = path.resolve(repoRoot, `contracts/v1/${options.mode}`);
  const buildRoot = path.resolve(repoRoot, ".tmp/api-contract");

  if (!options.skipBuild) {
    await run("pnpm", ["-r", "build"]);
  }

  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true });
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.mkdir(buildRoot, { recursive: true });

  const indexRows = [];

  for (const item of manifest) {
    if (item?.kind !== "public") continue;
    if (typeof item.name !== "string" || typeof item.entry !== "string") {
      throw new Error(`Invalid manifest item: ${JSON.stringify(item)}`);
    }

    const pkgDir = pkgDirFromName(item.name);
    const tsconfigPath = path.join(pkgDir, "tsconfig.json");
    const pkgBuildOut = path.join(buildRoot, pkgOutputName(item.name));
    await fs.mkdir(pkgBuildOut, { recursive: true });

    await run("pnpm", ["exec", "tsc", "-p", tsconfigPath, "--emitDeclarationOnly", "--declarationMap", "false", "--outDir", pkgBuildOut]);

    const entryDts = `${item.entry.replace(/^src\//, "").replace(/\.ts$/, ".d.ts")}`;
    const entryPath = path.join(pkgBuildOut, entryDts);

    const dtsRaw = await fs.readFile(entryPath, "utf8");
    const dtsNormalized = normalizeDts(dtsRaw);
    const outName = `${pkgOutputName(item.name)}.d.ts`;
    const outPath = path.join(outRoot, outName);
    await fs.writeFile(outPath, dtsNormalized, "utf8");

    const exports = collectExportLines(dtsNormalized);
    indexRows.push(`[${item.name}] ${outName}`);
    if (exports.length === 0) {
      indexRows.push("  (no direct export statements)");
    } else {
      for (const line of exports) {
        indexRows.push(`  ${line}`);
      }
    }
  }

  await fs.writeFile(path.join(outRoot, "INDEX.txt"), `${indexRows.join("\n")}\n`, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

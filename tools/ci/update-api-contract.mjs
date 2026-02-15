#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.resolve(repoRoot, "contracts/v1/manifest.json");
const goldenDir = path.resolve(repoRoot, "contracts/v1/golden");
const tmpDir = path.resolve(repoRoot, ".tmp/api-contract-update");

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
  return path.resolve(repoRoot, "packages", name.replace("@mesh/", ""));
}

function pkgOutputName(name) {
  return name.replace(/^@/, "").replace(/\//g, "__");
}

function normalizeDts(text) {
  const root = repoRoot.replaceAll("\\", "/");
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll(root, "<REPO_ROOT>")
    .replace(/^\/\/\s*(Generated|Auto-generated|Timestamp|Date):.*$/gim, "")
    .replace(/^\/\*\*[\s\S]*?@generated[\s\S]*?\*\/\n?/gim, "")
    .replace(/^\/\*\s*eslint[^*]*\*\/\n?/gim, "")
    .replace(/^\/\/[#@] sourceMappingURL=.*$/gim, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error("contracts/v1/manifest.json must be a non-empty array");
  }

  await fs.mkdir(goldenDir, { recursive: true });
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const overwritten = [];

  await run("pnpm", ["-r", "build"]);

  for (const item of manifest) {
    if (item?.kind !== "public") continue;
    if (typeof item.name !== "string" || typeof item.entry !== "string") {
      throw new Error(`Invalid manifest item: ${JSON.stringify(item)}`);
    }

    const pkgOutDir = path.join(tmpDir, pkgOutputName(item.name));
    await fs.mkdir(pkgOutDir, { recursive: true });

    await run("pnpm", [
      "exec",
      "tsc",
      "-p",
      path.join(pkgDirFromName(item.name), "tsconfig.json"),
      "--emitDeclarationOnly",
      "--declarationMap",
      "false",
      "--outDir",
      pkgOutDir
    ]);

    const entryDts = item.entry.replace(/^src\//, "").replace(/\.ts$/, ".d.ts");
    const sourceDtsPath = path.join(pkgOutDir, entryDts);
    const targetName = `${pkgOutputName(item.name)}.d.ts`;
    const targetPath = path.join(goldenDir, targetName);

    const sourceText = await fs.readFile(sourceDtsPath, "utf8");
    const normalized = normalizeDts(sourceText);

    const exists = await fs
      .access(targetPath)
      .then(() => true)
      .catch(() => false);
    if (exists) overwritten.push(targetName);

    await fs.writeFile(targetPath, normalized, "utf8");
  }

  console.log("Overwritten API contract files:");
  if (overwritten.length === 0) {
    console.log("- (none)");
  } else {
    for (const name of overwritten.sort()) {
      console.log(`- ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

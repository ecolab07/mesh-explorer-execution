#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const goldenDir = path.resolve(repoRoot, "contracts/v1/golden");
const generatedDir = path.resolve(repoRoot, "contracts/v1/generated");

async function run(cmd, args, cwd = repoRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${cmd} ${args.join(" ")} (exit ${code ?? "null"})`));
    });
  });
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function simpleDiff(expected, actual, maxChanges = 20) {
  const exp = expected.split("\n");
  const act = actual.split("\n");
  const max = Math.max(exp.length, act.length);
  const chunks = [];
  for (let i = 0; i < max; i += 1) {
    if (exp[i] !== act[i]) {
      chunks.push(`L${i + 1}\n  - ${exp[i] ?? "<EOF>"}\n  + ${act[i] ?? "<EOF>"}`);
      if (chunks.length >= maxChanges) break;
    }
  }
  return chunks.join("\n");
}

function collectExportNameLeaks(line) {
  const leaks = [];

  const exportedNames = line.match(/^export\s*\{([^}]*)\}/);
  if (exportedNames) {
    const parts = exportedNames[1].split(",").map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const alias = part.match(/\bas\s+([A-Za-z0-9_$]+)/);
      const exported = alias ? alias[1] : part;
      if (exported.startsWith("_")) leaks.push(exported);
    }
  }

  const declaredName = line.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|function|enum|namespace|let|var)\s+([A-Za-z0-9_$]+)/);
  if (declaredName && declaredName[1].startsWith("_")) {
    leaks.push(declaredName[1]);
  }

  return leaks;
}

function validateNoInternalLeaks(fileName, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("export ")) continue;

    if (/from\s+["'][^"']*\/internal\//.test(line)) {
      throw new Error(`API contract leak in ${fileName}: export from internal path at line ${i + 1}`);
    }

    const leakedNames = collectExportNameLeaks(line);
    if (leakedNames.length > 0) {
      throw new Error(`API contract leak in ${fileName}: underscored export ${leakedNames[0]} at line ${i + 1}`);
    }
  }
}

async function main() {
  await run("node", ["tools/ci/dump-api.mjs", "--mode=generated", "--skip-build"]);

  const goldenEntries = (await fs.readdir(goldenDir)).filter((name) => name.endsWith(".d.ts") || name === "INDEX.txt").sort();
  const generatedEntries = (await fs.readdir(generatedDir)).filter((name) => name.endsWith(".d.ts") || name === "INDEX.txt").sort();

  const missingInGenerated = goldenEntries.filter((name) => !generatedEntries.includes(name));
  const extraInGenerated = generatedEntries.filter((name) => !goldenEntries.includes(name));

  if (missingInGenerated.length > 0 || extraInGenerated.length > 0) {
    if (missingInGenerated.length > 0) {
      console.error(`Missing generated contract files: ${missingInGenerated.join(", ")}`);
    }
    if (extraInGenerated.length > 0) {
      console.error(`Unexpected generated contract files: ${extraInGenerated.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  for (const name of generatedEntries) {
    if (!name.endsWith(".d.ts")) continue;
    const generatedPath = path.join(generatedDir, name);
    const generatedText = await readText(generatedPath);
    validateNoInternalLeaks(name, generatedText);
  }

  for (const name of goldenEntries) {
    const goldenPath = path.join(goldenDir, name);
    const generatedPath = path.join(generatedDir, name);
    const [goldenText, generatedText] = await Promise.all([readText(goldenPath), readText(generatedPath)]);
    if (goldenText !== generatedText) {
      console.error(`API contract mismatch: ${name}`);
      console.error(simpleDiff(goldenText, generatedText));
      process.exitCode = 1;
      return;
    }
  }

  console.log("API contract check passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { generatedNameForPackage, goldenNameForPackage, isGoldenDeclarationFile, isIndexTextFile, normalizeConfigPath, stripIndexExtension } from "./api-contract-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.resolve(repoRoot, "contracts", "v1", "manifest.json");
const goldenDir = path.resolve(repoRoot, "contracts", "v1", "golden");
const generatedDir = path.resolve(repoRoot, "contracts", "v1", "generated");

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
  await run("node", [path.join("tools", "ci", "dump-api.mjs"), "--mode=generated", "--skip-build"]);

  const manifest = JSON.parse(await fs.readFile(normalizeConfigPath(manifestPath), "utf8"));
  const publicItems = manifest.filter((item) => item?.kind === "public" && typeof item?.name === "string");

  const goldenEntries = (await fs.readdir(goldenDir)).filter((name) => isGoldenDeclarationFile(name) || isIndexTextFile(name)).sort();
  const generatedEntries = (await fs.readdir(generatedDir)).filter((name) => name.endsWith(".d.ts") || isIndexTextFile(name)).sort();

  const expectedPairs = [];
  for (const item of publicItems) {
    const goldenName = await goldenNameForPackage(item.name, goldenDir);
    expectedPairs.push({
      generatedName: generatedNameForPackage(item.name),
      goldenName
    });
  }

  const missingInGenerated = expectedPairs.filter(({ generatedName }) => !generatedEntries.includes(generatedName)).map(({ generatedName }) => generatedName);
  const missingInGolden = expectedPairs.filter(({ goldenName }) => !goldenEntries.includes(goldenName)).map(({ goldenName }) => goldenName);
  const expectedGeneratedSet = new Set(expectedPairs.map(({ generatedName }) => generatedName));
  const expectedGoldenSet = new Set(expectedPairs.map(({ goldenName }) => goldenName));
  const extraInGenerated = generatedEntries.filter((name) => !isIndexTextFile(name) && !expectedGeneratedSet.has(name));
  const extraInGolden = goldenEntries.filter((name) => !isIndexTextFile(name) && !expectedGoldenSet.has(name));

  const goldenIndexName = goldenEntries.find((name) => stripIndexExtension(name) === "INDEX");
  const generatedIndexName = generatedEntries.find((name) => stripIndexExtension(name) === "INDEX");

  if (missingInGenerated.length > 0 || missingInGolden.length > 0 || extraInGenerated.length > 0 || extraInGolden.length > 0 || !goldenIndexName || !generatedIndexName) {
    if (missingInGenerated.length > 0) {
      console.error(`Missing generated contract files: ${missingInGenerated.join(", ")}`);
    }
    if (missingInGolden.length > 0) {
      console.error(`Missing golden contract files: ${missingInGolden.join(", ")}`);
    }
    if (extraInGenerated.length > 0) {
      console.error(`Unexpected generated contract files: ${extraInGenerated.join(", ")}`);
    }
    if (extraInGolden.length > 0) {
      console.error(`Unexpected golden contract files: ${extraInGolden.join(", ")}`);
    }
    if (!goldenIndexName) {
      console.error("Missing golden contract index file: expected INDEX or INDEX.txt");
    }
    if (!generatedIndexName) {
      console.error("Missing generated contract index file: expected INDEX or INDEX.txt");
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

  for (const { goldenName, generatedName } of expectedPairs) {
    const goldenPath = path.join(normalizeConfigPath(goldenDir), goldenName);
    const generatedPath = path.join(normalizeConfigPath(generatedDir), generatedName);
    const [goldenText, generatedText] = await Promise.all([readText(goldenPath), readText(generatedPath)]);
    if (goldenText !== generatedText) {
      console.error(`API contract mismatch: golden=${goldenName}, generated=${generatedName}`);
      console.error(simpleDiff(goldenText, generatedText));
      process.exitCode = 1;
      return;
    }
  }

  if (goldenIndexName && generatedIndexName) {
    const [goldenIndex, generatedIndex] = await Promise.all([
      readText(path.join(normalizeConfigPath(goldenDir), goldenIndexName)),
      readText(path.join(normalizeConfigPath(generatedDir), generatedIndexName))
    ]);
    if (goldenIndex !== generatedIndex) {
      console.error(`API contract INDEX mismatch: golden=${goldenIndexName}, generated=${generatedIndexName}`);
      console.error(simpleDiff(goldenIndex, generatedIndex));
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

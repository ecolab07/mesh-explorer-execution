#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { goldenNameForPackage, normalizeConfigPath } from "./api-contract-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const manifestPath = path.join(repoRoot, "contracts", "v1", "manifest.json");
const policyPath = path.join(repoRoot, "contracts", "v1", "reasonCodes-policy.md");

function uniq(values) {
  return [...new Set(values)];
}

function parseReasonCodesFromSource(text) {
  const blockMatch = text.match(/export\s+const\s+REASON_CODES\s*=\s*\{([\s\S]*?)\}\s*as\s+const\s*;/m);
  if (!blockMatch) {
    throw new Error("Could not find REASON_CODES object in reasonCodes source.");
  }

  const values = [];
  const valueRegex = /:\s*"([^"]+)"\s*,?/g;
  for (const match of blockMatch[1].matchAll(valueRegex)) {
    values.push(match[1]);
  }

  if (values.length === 0) {
    throw new Error("No reasonCode values found in REASON_CODES object.");
  }

  return uniq(values).sort();
}

function parseReasonCodesFromPolicy(text) {
  const sectionMatch = text.match(/^##\s+ReasonCodes list\s*$([\s\S]*?)(?=^##\s+|\Z)/m);
  if (!sectionMatch) {
    throw new Error('Missing "## ReasonCodes list" section in contracts/v1/reasonCodes-policy.md');
  }

  const values = [];
  const bulletRegex = /^\s*-\s+`([^`]+)`/gm;
  for (const match of sectionMatch[1].matchAll(bulletRegex)) {
    values.push(match[1].trim());
  }

  if (values.length === 0) {
    throw new Error('No reasonCode bullets found under "## ReasonCodes list".');
  }

  return uniq(values).sort();
}

async function resolveReasonCodesSourcePath() {
  const manifest = JSON.parse(await fs.readFile(normalizeConfigPath(manifestPath), "utf8"));
  const shared = manifest.find((item) => item?.kind === "public" && item?.name === "@mesh/shared");
  if (!shared || typeof shared.entry !== "string") {
    throw new Error("Unable to resolve @mesh/shared entry from contracts/v1/manifest.json");
  }

  const goldenDir = path.join(repoRoot, "contracts", "v1", "golden");
  const goldenName = await goldenNameForPackage(shared.name, goldenDir);
  const goldenEntry = path.join(goldenDir, goldenName);
  const goldenText = await fs.readFile(goldenEntry, "utf8");
  const exportMatch = goldenText.match(/^export\s+\*\s+from\s+["'](\.\/reasonCodes\.js)["'];\s*$/m);
  if (!exportMatch) {
    throw new Error(`Could not find reasonCodes export in ${path.relative(repoRoot, goldenEntry)}`);
  }

  const entryDir = path.dirname(normalizeConfigPath(shared.entry));
  const reasonCodesRelTs = exportMatch[1].replace(/^\.\//, "").replace(/\.js$/, ".ts");
  return path.join(repoRoot, "packages", "shared", entryDir, reasonCodesRelTs);
}

async function main() {
  const [reasonCodesSourcePath, policyText] = await Promise.all([
    resolveReasonCodesSourcePath(),
    fs.readFile(normalizeConfigPath(policyPath), "utf8")
  ]);

  const contractText = await fs.readFile(reasonCodesSourcePath, "utf8");
  const contractCodes = parseReasonCodesFromSource(contractText);
  const policyCodes = parseReasonCodesFromPolicy(policyText);

  const contractSet = new Set(contractCodes);
  const policySet = new Set(policyCodes);

  const missingInPolicy = contractCodes.filter((code) => !policySet.has(code));
  const extraInPolicy = policyCodes.filter((code) => !contractSet.has(code));

  if (missingInPolicy.length > 0 || extraInPolicy.length > 0) {
    if (missingInPolicy.length > 0) {
      console.error("reasonCodes missing in policy:");
      for (const code of missingInPolicy) console.error(`- ${code}`);
    }
    if (extraInPolicy.length > 0) {
      console.error("reasonCodes present in policy but missing from contract:");
      for (const code of extraInPolicy) console.error(`- ${code}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`reasonCodes policy check passed (${contractCodes.length} codes).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const testsRoot = path.resolve(repoRoot, "packages/conformance-tests/src");
const artifactsDir = path.resolve(repoRoot, "artifacts");
const expectedInvariantsPath = path.resolve(repoRoot, "packages/conformance-tests/expected-invariants.json");

const invTagPattern = /\[INV:([^\]]+)\]\[SURF:([^\]]+)\]\s*(.*)$/;
const testPattern = /it\(\s*"([^"\n]+)"\s*,/g;

async function listTestFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listTestFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".test.ts")) return [fullPath];
      return [];
    })
  );
  return files.flat().sort();
}

function compact(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractOracle(block, fallbackTitle) {
  const expectLines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("expect("))
    .map((line) => compact(line));

  if (expectLines.length === 0) {
    return `Heuristic: ${fallbackTitle}`;
  }

  return `Asserts ${expectLines.length} expectation(s): ${expectLines.join(" ; ")}`;
}

function extractSetup(block) {
  const setupLines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("const ") || line.startsWith("await "))
    .filter((line) => !line.startsWith("await expect("))
    .slice(0, 2)
    .map((line) => compact(line.replace(/;$/, "")));

  if (setupLines.length === 0) return "Setup inferred from test body.";
  return setupLines.join("; ");
}

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

function commandOutput(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function markdownTable(rows) {
  const header = "| InvariantID | Surface | Test(s) | Oracle | Preconditions / Setup | Limitations connues |";
  const sep = "|---|---|---|---|---|---|";
  const body = rows
    .map((row) => {
      const testRef = `${row.file}::${row.testName}`;
      return `| ${row.invariantId} | ${row.surface} | ${testRef} | ${row.oracle} | ${row.setup} | ${row.limitations ?? ""} |`;
    })
    .join("\n");
  return [header, sep, body].join("\n");
}

function escapeCell(value) {
  return value.replace(/\|/g, "\\|");
}

async function main() {
  const testFiles = await listTestFiles(testsRoot);
  const expectedInvariants = await readJson(expectedInvariantsPath);
  const suiteNames = [];
  const evidenceRows = [];
  const untaggedConformanceTests = [];

  for (const filePath of testFiles) {
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
    const content = await fs.readFile(filePath, "utf8");

    const describeMatches = content.matchAll(/describe\(\s*"([^"\n]+)"/g);
    for (const match of describeMatches) {
      suiteNames.push(match[1]);
    }

    const matches = [...content.matchAll(testPattern)];
    for (let idx = 0; idx < matches.length; idx += 1) {
      const current = matches[idx];
      const next = matches[idx + 1];
      const rawTitle = current[1];
      const blockStart = current.index ?? 0;
      const blockEnd = next?.index ?? content.length;
      const block = content.slice(blockStart, blockEnd);

      const hasConformanceId = /CT-[A-Z-]+\d+/.test(rawTitle);
      const tagMatch = rawTitle.match(invTagPattern);

      if (hasConformanceId && !tagMatch) {
        untaggedConformanceTests.push(`${relativePath}::${rawTitle}`);
        continue;
      }

      if (!tagMatch) continue;

      const [, invariantId, surface, testName] = tagMatch;
      evidenceRows.push({
        invariantId,
        surface,
        testName,
        file: relativePath,
        oracle: extractOracle(block, testName),
        setup: extractSetup(block),
        limitations: ""
      });
    }
  }

  if (untaggedConformanceTests.length > 0) {
    throw new Error(`Conformance tests missing invariant tags:\n${untaggedConformanceTests.join("\n")}`);
  }

  const observed = new Set(evidenceRows.map((row) => row.invariantId));
  const missingInvariants = expectedInvariants.filter((id) => !observed.has(id));

  if (missingInvariants.length > 0) {
    throw new Error(`Expected invariants without tests: ${missingInvariants.join(", ")}`);
  }

  evidenceRows.sort((a, b) => a.invariantId.localeCompare(b.invariantId));

  const commitSha = commandOutput("git rev-parse HEAD");
  const nodeVersion = process.version;
  const pnpmVersion = commandOutput("pnpm --version");
  const rootPackage = await readJson(path.resolve(repoRoot, "package.json"));
  const vitestVersion = rootPackage.devDependencies?.vitest ?? "unknown";
  const generatedAt = new Date().toISOString();

  const escapedRows = evidenceRows.map((row) => ({
    ...row,
    oracle: escapeCell(row.oracle),
    setup: escapeCell(row.setup),
    limitations: escapeCell(row.limitations ?? "")
  }));

  const gapsSection =
    missingInvariants.length === 0
      ? "Coverage gaps: none."
      : `Coverage gaps:\n${missingInvariants.map((id) => `- ${id}`).join("\n")}`;

  const markdown = [
    "# Conformance Evidence",
    "",
    `- Commit SHA: ${commitSha}`,
    `- Generated at (UTC): ${generatedAt}`,
    `- Node: ${nodeVersion}`,
    `- pnpm: ${pnpmVersion}`,
    `- Vitest: ${vitestVersion}`,
    `- Suites: ${[...new Set(suiteNames)].join(", ")}`,
    "",
    "## Invariant Coverage",
    markdownTable(escapedRows),
    "",
    "## Coverage gaps",
    gapsSection,
    ""
  ].join("\n");

  await fs.mkdir(artifactsDir, { recursive: true });

  const jsonPayload = {
    metadata: {
      commitSha,
      generatedAt,
      nodeVersion,
      pnpmVersion,
      vitestVersion,
      suites: [...new Set(suiteNames)]
    },
    invariants: evidenceRows,
    coverageGaps: missingInvariants
  };

  const mdPath = path.resolve(artifactsDir, "conformance-evidence.md");
  const jsonPath = path.resolve(artifactsDir, "conformance-evidence.json");
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");

  console.log(`Generated evidence:\n- ${mdPath}\n- ${jsonPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

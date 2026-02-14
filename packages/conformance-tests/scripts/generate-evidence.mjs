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
const evidenceReporterPath = path.resolve(repoRoot, "packages/conformance-tests/scripts/evidence-meta-reporter.mjs");
const runtimeMetaPath = path.resolve(artifactsDir, "conformance-evidence.runtime.meta.json");

const testPattern = /it\(\s*"([^"\n]+)"\s*,/g;
const conformanceIdPattern = /CT-[A-Z0-9-]+/;
const allowedCriticality = new Set(["Critical", "Structural", "Regression"]);

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

function runCommand(cmd, env = {}) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function collectRuntimeMeta() {
  runCommand(
    `pnpm exec vitest run packages/conformance-tests/src --reporter ${evidenceReporterPath}`,
    { MESH_EVIDENCE_META_PATH: runtimeMetaPath }
  );

  return readJson(runtimeMetaPath);
}

function markdownTable(rows) {
  const header = "| InvariantID | Surface | Test(s) | Oracle | Criticality | Preconditions / Setup | Limitations connues |";
  const sep = "|---|---|---|---|---|---|---|";
  const body = rows
    .map((row) => {
      const testRef = `${row.file}::${row.testName}`;
      return `| ${row.invariantId} | ${row.surface} | ${testRef} | ${row.oracle} | ${row.criticality} | ${row.setup} | ${row.limitations ?? ""} |`;
    })
    .join("\n");
  return [header, sep, body].join("\n");
}

function buildMarkdown(title, suiteNames, vitestVersion, rows, criticalitySummary, criticalInvariantIds, gapsSection) {
  return [
    `# ${title}`,
    "",
    `- Vitest: ${vitestVersion}`,
    `- Suites: ${[...new Set(suiteNames)].join(", ")}`,
    "",
    "## Invariant Coverage",
    markdownTable(rows),
    "",
    "## Criticality summary",
    `- Critical: ${criticalitySummary.Critical}`,
    `- Structural: ${criticalitySummary.Structural}`,
    `- Regression: ${criticalitySummary.Regression}`,
    `- Critical IDs: ${criticalInvariantIds.join(", ") || "none"}`,
    "",
    "## Coverage gaps",
    gapsSection,
    ""
  ].join("\n");
}

function escapeCell(value) {
  return value.replace(/\|/g, "\\|");
}

function sortByInvariantId(left, right) {
  return left.invariantId.localeCompare(right.invariantId);
}

async function main() {
  const testFiles = await listTestFiles(testsRoot);
  const expectedInvariants = await readJson(expectedInvariantsPath);
  const expectedById = new Map();
  for (const expected of expectedInvariants) {
    if (typeof expected?.invariantId !== "string") {
      throw new Error("expected-invariants.json contains an item without invariantId");
    }
    if (expectedById.has(expected.invariantId)) {
      throw new Error(`expected-invariants.json contains duplicate invariantId: ${expected.invariantId}`);
    }
    if (typeof expected.surface !== "string" || expected.surface.trim().length === 0) {
      throw new Error(`expected-invariants.json has invalid surface for ${expected.invariantId}`);
    }
    if (typeof expected.criticality !== "string" || !allowedCriticality.has(expected.criticality)) {
      throw new Error(`expected-invariants.json has invalid criticality for ${expected.invariantId}`);
    }
    expectedById.set(expected.invariantId, expected);
  }

  const expectedSorted = [...expectedInvariants].sort(sortByInvariantId);
  for (let index = 0; index < expectedInvariants.length; index += 1) {
    if (expectedInvariants[index].invariantId !== expectedSorted[index].invariantId) {
      throw new Error("expected-invariants.json must be sorted by invariantId");
    }
  }

  const runtimeTests = await collectRuntimeMeta();
  const suiteNames = [];
  const setupByTestRef = new Map();

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
      const testName = current[1];
      const blockStart = current.index ?? 0;
      const blockEnd = next?.index ?? content.length;
      const block = content.slice(blockStart, blockEnd);

      setupByTestRef.set(`${relativePath}::${testName}`, extractSetup(block));
    }
  }

  const invalidConformance = [];
  const evidenceRows = [];
  const seenInvariantIds = new Map();
  for (const test of runtimeTests) {
    const relativePath = path.relative(repoRoot, test.file).replaceAll(path.sep, "/");
    const testRef = `${relativePath}::${test.name}`;
    const hasConformanceIdInName = conformanceIdPattern.test(test.name);
    const invariantId = test.meta?.invariantId;
    const isConformance = hasConformanceIdInName || (typeof invariantId === "string" && conformanceIdPattern.test(invariantId));

    if (!isConformance) continue;

    const oracle = test.meta?.oracle;
    const criticality = test.meta?.criticality;
    const surface = test.meta?.surface;

    if (typeof invariantId !== "string" || !conformanceIdPattern.test(invariantId)) {
      invalidConformance.push(`${testRef} -> missing/invalid meta.invariantId`);
    }
    if (typeof surface !== "string" || surface.trim().length === 0) {
      invalidConformance.push(`${testRef} -> missing meta.surface`);
    }
    if (typeof oracle !== "string" || oracle.trim().length === 0) {
      invalidConformance.push(`${testRef} -> missing meta.oracle`);
    }
    if (typeof criticality !== "string" || !allowedCriticality.has(criticality)) {
      invalidConformance.push(`${testRef} -> missing/invalid meta.criticality`);
    }
    if (typeof invariantId === "string" && seenInvariantIds.has(invariantId)) {
      invalidConformance.push(
        `${testRef} -> duplicate meta.invariantId already declared by ${seenInvariantIds.get(invariantId)}`
      );
    }

    const expected = typeof invariantId === "string" ? expectedById.get(invariantId) : undefined;
    if (typeof invariantId === "string" && !expected) {
      invalidConformance.push(`${testRef} -> invariantId not declared in expected-invariants.json`);
    }
    if (expected && typeof surface === "string" && expected.surface !== surface) {
      invalidConformance.push(
        `${testRef} -> surface mismatch for ${invariantId}: expected ${expected.surface}, got ${surface}`
      );
    }
    if (expected && typeof criticality === "string" && expected.criticality !== criticality) {
      invalidConformance.push(
        `${testRef} -> criticality mismatch for ${invariantId}: expected ${expected.criticality}, got ${criticality}`
      );
    }

    if (
      typeof invariantId === "string" &&
      typeof surface === "string" &&
      typeof oracle === "string" &&
      typeof criticality === "string" &&
      allowedCriticality.has(criticality)
    ) {
      evidenceRows.push({
        invariantId,
        surface,
        testName: test.name,
        file: relativePath,
        oracle: compact(oracle),
        criticality,
        setup: setupByTestRef.get(testRef) ?? "Setup inferred from test body.",
        limitations: ""
      });
      seenInvariantIds.set(invariantId, testRef);
    }
  }

  if (invalidConformance.length > 0) {
    throw new Error(`Conformance tests missing required meta:\n${invalidConformance.join("\n")}`);
  }

  const observed = new Set(evidenceRows.map((row) => row.invariantId));
  const missingInvariants = [...expectedById.keys()].filter((id) => !observed.has(id)).sort();

  if (missingInvariants.length > 0) {
    throw new Error(`Expected invariants without tests: ${missingInvariants.join(", ")}`);
  }

  evidenceRows.sort(sortByInvariantId);

  const criticalitySummary = {
    Critical: evidenceRows.filter((row) => row.criticality === "Critical").length,
    Structural: evidenceRows.filter((row) => row.criticality === "Structural").length,
    Regression: evidenceRows.filter((row) => row.criticality === "Regression").length
  };
  const criticalInvariantIds = evidenceRows.filter((row) => row.criticality === "Critical").map((row) => row.invariantId);

  const commitSha = commandOutput("git rev-parse HEAD");
  const nodeVersion = process.version;
  const pnpmVersion = commandOutput("pnpm --version");
  const rootPackage = await readJson(path.resolve(repoRoot, "package.json"));
  const vitestVersion = rootPackage.devDependencies?.vitest ?? "unknown";
  const generatedAt = commandOutput("git show -s --format=%cI HEAD");

  const escapedRows = evidenceRows.map((row) => ({
    ...row,
    oracle: escapeCell(row.oracle),
    criticality: escapeCell(row.criticality),
    setup: escapeCell(row.setup),
    limitations: escapeCell(row.limitations ?? "")
  }));

  const gapsSection =
    missingInvariants.length === 0
      ? "Coverage gaps: none."
      : `Coverage gaps:\n${missingInvariants.map((id) => `- ${id}`).join("\n")}`;

  const markdown = buildMarkdown(
    "Conformance Evidence",
    suiteNames,
    vitestVersion,
    escapedRows,
    criticalitySummary,
    criticalInvariantIds,
    gapsSection
  );

  const criticalRows = escapedRows.filter((row) => row.criticality === "Critical");
  const criticalMarkdown = buildMarkdown(
    "Conformance Evidence (Critical)",
    suiteNames,
    vitestVersion,
    criticalRows,
    {
      Critical: criticalRows.length,
      Structural: 0,
      Regression: 0
    },
    criticalInvariantIds,
    "Coverage gaps: none."
  );

  await fs.mkdir(artifactsDir, { recursive: true });

  const jsonPayload = {
    metadata: {
      vitestVersion,
      suites: [...new Set(suiteNames)].sort()
    },
    invariants: evidenceRows,
    criticalitySummary,
    criticalInvariantIds,
    coverageGaps: missingInvariants
  };

  const runtimePayload = {
    metadata: {
      commitSha,
      generatedAt,
      nodeVersion,
      pnpmVersion,
      vitestVersion,
      suites: [...new Set(suiteNames)].sort(),
      runner: {
        platform: process.platform,
        arch: process.arch
      }
    }
  };

  const mdPath = path.resolve(artifactsDir, "conformance-evidence.md");
  const criticalMdPath = path.resolve(artifactsDir, "conformance-evidence.critical.md");
  const jsonPath = path.resolve(artifactsDir, "conformance-evidence.json");
  const runtimeJsonPath = path.resolve(artifactsDir, "conformance-evidence.runtime.json");
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(criticalMdPath, criticalMarkdown, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(runtimeJsonPath, `${JSON.stringify(runtimePayload, null, 2)}\n`, "utf8");
  await fs.rm(runtimeMetaPath, { force: true });

  console.log(`Generated evidence:\n- ${mdPath}\n- ${criticalMdPath}\n- ${jsonPath}\n- ${runtimeJsonPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

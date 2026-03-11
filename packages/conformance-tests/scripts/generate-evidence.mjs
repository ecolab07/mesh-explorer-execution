import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const testsRoot = path.resolve(repoRoot, "packages/conformance-tests/src");
const artifactsDir = path.resolve(repoRoot, "artifacts");
const expectedInvariantsPath = path.resolve(repoRoot, "packages/conformance-tests/expected-invariants.json");
const evidenceVitestConfigPath = path.resolve(repoRoot, "packages/conformance-tests/vitest.evidence.config.mjs");

const testPattern = /it\(\s*"([^"\n]+)"\s*,/g;
const conformanceIdPattern = /CT-[A-Z0-9-]+/;
const allowedCriticality = new Set(["Critical", "Structural", "Regression"]);
const ALL_BACKENDS = [
  { env: "inmemory", label: "InMemory", requiredCriticalOnly: false },
  { env: "persistent", label: "Persistent", requiredCriticalOnly: true }
];


function resolveBackendsFromEnv() {
  const meshBackend = process.env.MESH_BACKEND;
  const meshTestBackend = process.env.MESH_TEST_BACKEND;
  const meshPersistence = process.env.MESH_PERSISTENCE;
  console.log(
    `[generate-evidence] backend env: MESH_BACKEND=${meshBackend ?? "<unset>"}, MESH_TEST_BACKEND=${meshTestBackend ?? "<unset>"}, MESH_PERSISTENCE=${meshPersistence ?? "<unset>"}`
  );

  const candidates = [
    ["MESH_BACKEND", meshBackend],
    ["MESH_TEST_BACKEND", meshTestBackend],
    ["MESH_PERSISTENCE", meshPersistence]
  ];
  const chosen = candidates.find(([, value]) => typeof value === "string" && value.trim().length > 0);
  if (!chosen) {
    console.log("[generate-evidence] backend source: none (running all backends)");
    return ALL_BACKENDS;
  }

  const [source, rawValue] = chosen;
  const normalized = rawValue.trim().toLowerCase();
  const backend = ALL_BACKENDS.find((entry) => entry.env === normalized);
  if (!backend) {
    const allowed = ALL_BACKENDS.map((entry) => entry.env).join(", ");
    throw new Error(`[generate-evidence] unsupported backend from ${source}=${rawValue}. Allowed: ${allowed}`);
  }

  console.log(`[generate-evidence] backend source: ${source}=${rawValue}; selected=${backend.env}`);
  return [backend];
}

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

function formatRuntimeMetaFailure({
  backendEnv,
  command,
  runtimeMetaPath,
  exists,
  size,
  readError,
  parseError,
  rawSnippet
}) {
  return [
    `[generate-evidence] backend=${backendEnv}`,
    `[generate-evidence] command=${command}`,
    `[generate-evidence] runtimeMetaPath=${runtimeMetaPath}`,
    `[generate-evidence] runtimeMeta.exists=${exists}`,
    `[generate-evidence] runtimeMeta.sizeBytes=${size ?? "<unknown>"}`,
    `[generate-evidence] runtimeMeta.readError=${readError ?? "<none>"}`,
    `[generate-evidence] runtimeMeta.parseError=${parseError ?? "<none>"}`,
    `[generate-evidence] runtimeMeta.rawSnippet=${rawSnippet ?? "<none>"}`
  ].join("\n");
}

async function readRuntimeMetaOrThrow(backendEnv, command, runtimeMetaPath) {
  let stat;
  try {
    stat = await fs.stat(runtimeMetaPath);
  } catch {
    throw new Error(
      formatRuntimeMetaFailure({
        backendEnv,
        command,
        runtimeMetaPath,
        exists: false
      })
    );
  }

  let raw;
  try {
    raw = await fs.readFile(runtimeMetaPath, "utf8");
  } catch (error) {
    throw new Error(
      formatRuntimeMetaFailure({
        backendEnv,
        command,
        runtimeMetaPath,
        exists: true,
        size: stat.size,
        readError: error.message
      })
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      formatRuntimeMetaFailure({
        backendEnv,
        command,
        runtimeMetaPath,
        exists: true,
        size: stat.size,
        parseError: error.message,
        rawSnippet: raw.slice(0, 400)
      })
    );
  }
}

async function makeRuntimeMetaPath(backendEnv) {
  const prefix = `mesh-evidence-${backendEnv}-`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    runtimeMetaPath: path.join(tempDir, "runtime.meta.json")
  };
}

async function collectRuntimeMeta(backendEnv) {
  const args = [
    "./packages/conformance-tests/scripts/run-vitest-with-env.mjs",
    "--config",
    "./packages/conformance-tests/vitest.evidence.config.mjs"
  ];
  const command = `node ${args.join(" ")}`;
  const { tempDir, runtimeMetaPath } = await makeRuntimeMetaPath(backendEnv);
  const env = {
    ...process.env,
    MESH_EVIDENCE_META_PATH: runtimeMetaPath,
    MESH_BACKEND: backendEnv,
    MESH_TX_VISIBILITY_POLICY: "acl",
    MESH_VITEST_STDIO: "pipe"
  };

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      stdio: "pipe"
    });

    if (result.error || result.status !== 0) {
      const details = [
        `[generate-evidence] backend=${backendEnv}`,
        `[generate-evidence] command=${command}`,
        `[generate-evidence] cwd=${repoRoot}`,
        `[generate-evidence] vitestConfig=${evidenceVitestConfigPath}`,
        `[generate-evidence] runtimeMetaPath=${runtimeMetaPath}`,
        `[generate-evidence] env.MESH_BACKEND=${env.MESH_BACKEND}`,
        `[generate-evidence] env.MESH_TX_VISIBILITY_POLICY=${env.MESH_TX_VISIBILITY_POLICY}`,
        `[generate-evidence] env.MESH_VITEST_STDIO=${env.MESH_VITEST_STDIO}`,
        `[generate-evidence] env.MESH_EVIDENCE_META_PATH=${env.MESH_EVIDENCE_META_PATH}`,
        `[generate-evidence] process.execPath=${process.execPath}`,
        `[generate-evidence] PATH=${process.env.PATH ?? "<unset>"}`,
        `[generate-evidence] exitCode=${String(result.status)}`,
        `[generate-evidence] signal=${String(result.signal)}`,
        `[generate-evidence] spawnError.message=${result.error?.message ?? "<none>"}`,
        `[generate-evidence] spawnError.code=${result.error?.code ?? "<none>"}`,
        `[generate-evidence] spawnError.stack=${result.error?.stack ?? "<none>"}`,
        `[generate-evidence] stdout:
${result.stdout ?? "<null>"}`,
        `[generate-evidence] stderr:
${result.stderr ?? "<null>"}`
      ].join("\n\n");
      throw new Error(details);
    }

    return await readRuntimeMetaOrThrow(backendEnv, command, runtimeMetaPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function markdownTable(rows) {
  const header = "| InvariantID | Surface | Backend | Test(s) | Oracle | Criticality | Preconditions / Setup | Limitations connues |";
  const sep = "|---|---|---|---|---|---|---|---|";
  const body = rows
    .map((row) => {
      const testRef = `${row.file}::${row.testName}`;
      return `| ${row.invariantId} | ${row.surface} | ${row.backend} | ${testRef} | ${row.oracle} | ${row.criticality} | ${row.setup} | ${row.limitations ?? ""} |`;
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

function summarize(rows) {
  const criticalitySummary = {
    Critical: rows.filter((row) => row.criticality === "Critical").length,
    Structural: rows.filter((row) => row.criticality === "Structural").length,
    Regression: rows.filter((row) => row.criticality === "Regression").length
  };
  const criticalInvariantIds = rows.filter((row) => row.criticality === "Critical").map((row) => row.invariantId);
  return { criticalitySummary, criticalInvariantIds };
}

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true });

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

  const suiteNames = [];
  const setupByTestRef = new Map();

  for (const filePath of testFiles) {
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
    const content = await fs.readFile(filePath, "utf8");

    const describeMatches = content.matchAll(/describe\(\s*"([^"\n]+)"/g);
    const describeEachMatches = content.matchAll(/describe\.each\([^\n]+?\)\(\s*"([^"\n]+)"/g);
    for (const match of [...describeMatches, ...describeEachMatches]) {
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

  const backends = resolveBackendsFromEnv();
  const backendPayloads = {};
  for (const backend of backends) {
    const runtimeTests = await collectRuntimeMeta(backend.env);
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
          backend: backend.label,
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
      throw new Error(`Conformance tests missing required meta (${backend.label}):\n${invalidConformance.join("\n")}`);
    }

    evidenceRows.sort(sortByInvariantId);

    const observed = new Set(evidenceRows.map((row) => row.invariantId));
    const expectedScope = backend.requiredCriticalOnly
      ? expectedInvariants.filter((item) => item.criticality === "Critical")
      : expectedInvariants;
    const missingInvariants = expectedScope
      .map((item) => item.invariantId)
      .filter((id) => !observed.has(id))
      .sort();

    if (missingInvariants.length > 0) {
      const scopeText = backend.requiredCriticalOnly ? "critical invariants" : "expected invariants";
      throw new Error(`${backend.label} backend missing ${scopeText}: ${missingInvariants.join(", ")}`);
    }

    const { criticalitySummary, criticalInvariantIds } = summarize(evidenceRows);
    backendPayloads[backend.label] = {
      invariants: evidenceRows,
      criticalitySummary,
      criticalInvariantIds,
      coverageGaps: missingInvariants
    };
  }

  const commitSha = commandOutput("git rev-parse HEAD");
  const nodeVersion = process.version;
  const pnpmVersion = commandOutput("pnpm --version");
  const rootPackage = await readJson(path.resolve(repoRoot, "package.json"));
  const vitestVersion = rootPackage.devDependencies?.vitest ?? "unknown";
  const generatedAt = commandOutput("git show -s --format=%cI HEAD");

  const escapedAllRows = backends.flatMap(({ label }) => backendPayloads[label].invariants).map((row) => ({
    ...row,
    oracle: escapeCell(row.oracle),
    criticality: escapeCell(row.criticality),
    setup: escapeCell(row.setup),
    limitations: escapeCell(row.limitations ?? "")
  }));

  const combinedSummary = summarize(escapedAllRows);
  const primaryBackendLabel = backendPayloads.InMemory ? "InMemory" : backends[0].label;
  const primaryPayload = backendPayloads[primaryBackendLabel];

  const markdown = buildMarkdown(
    "Conformance Evidence",
    suiteNames,
    vitestVersion,
    escapedAllRows,
    combinedSummary.criticalitySummary,
    combinedSummary.criticalInvariantIds,
    "Coverage gaps: none."
  );

  const criticalRows = escapedAllRows.filter((row) => row.criticality === "Critical");
  const criticalMarkdown = buildMarkdown(
    "Conformance Evidence (Critical)",
    suiteNames,
    vitestVersion,
    criticalRows,
    { Critical: criticalRows.length, Structural: 0, Regression: 0 },
    combinedSummary.criticalInvariantIds,
    "Coverage gaps: none."
  );

  const persistentRows = (backendPayloads.Persistent?.invariants ?? []).map((row) => ({
    ...row,
    oracle: escapeCell(row.oracle),
    criticality: escapeCell(row.criticality),
    setup: escapeCell(row.setup),
    limitations: escapeCell(row.limitations ?? "")
  }));

  const persistentMarkdown = backendPayloads.Persistent
    ? buildMarkdown(
        "Conformance Evidence (Persistent backend)",
        suiteNames,
        vitestVersion,
        persistentRows,
        backendPayloads.Persistent.criticalitySummary,
        backendPayloads.Persistent.criticalInvariantIds,
        "Coverage gaps: none."
      )
    : "# Conformance Evidence (Persistent backend)\n\nCoverage not collected in this run.\n";

  const jsonPayload = {
    metadata: {
      vitestVersion,
      suites: [...new Set(suiteNames)].sort(),
      backends: backends.map((backend) => backend.label)
    },
    backends: backendPayloads,
    invariants: primaryPayload.invariants,
    criticalitySummary: primaryPayload.criticalitySummary,
    criticalInvariantIds: primaryPayload.criticalInvariantIds,
    coverageGaps: primaryPayload.coverageGaps
  };

  const runtimePayload = {
    metadata: {
      commitSha,
      generatedAt,
      nodeVersion,
      pnpmVersion,
      vitestVersion,
      suites: [...new Set(suiteNames)].sort(),
      backends: backends.map((backend) => backend.label),
      runner: {
        platform: process.platform,
        arch: process.arch
      }
    }
  };

  const mdPath = path.resolve(artifactsDir, "conformance-evidence.md");
  const criticalMdPath = path.resolve(artifactsDir, "conformance-evidence.critical.md");
  const persistentMdPath = path.resolve(artifactsDir, "conformance-evidence.persistent.md");
  const jsonPath = path.resolve(artifactsDir, "conformance-evidence.json");
  const runtimeJsonPath = path.resolve(artifactsDir, "conformance-evidence.runtime.json");

  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(criticalMdPath, criticalMarkdown, "utf8");
  await fs.writeFile(persistentMdPath, persistentMarkdown, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(runtimeJsonPath, `${JSON.stringify(runtimePayload, null, 2)}\n`, "utf8");
  console.log(`Generated evidence:\n- ${mdPath}\n- ${criticalMdPath}\n- ${persistentMdPath}\n- ${jsonPath}\n- ${runtimeJsonPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

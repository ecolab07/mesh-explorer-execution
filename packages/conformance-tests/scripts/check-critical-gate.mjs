import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const evidencePath = path.resolve(repoRoot, "artifacts/conformance-evidence.json");
const expectedInvariantsPath = path.resolve(repoRoot, "packages/conformance-tests/expected-invariants.json");

const MIN_EXPECTED_CRITICAL = 1;

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const [evidence, expectedInvariants] = await Promise.all([readJson(evidencePath), readJson(expectedInvariantsPath)]);

  const criticalCount = Number(evidence?.criticalitySummary?.Critical ?? 0);
  const criticalIds = Array.isArray(evidence?.criticalInvariantIds)
    ? evidence.criticalInvariantIds.filter((id) => typeof id === "string")
    : [];
  const coverageGaps = Array.isArray(evidence?.coverageGaps)
    ? evidence.coverageGaps.filter((id) => typeof id === "string")
    : [];

  const expectedCriticalIds = expectedInvariants
    .filter((item) => item?.criticality === "Critical" && typeof item?.invariantId === "string")
    .map((item) => item.invariantId)
    .sort();

  const missingCriticalCoverage = coverageGaps.filter((id) => expectedCriticalIds.includes(id));

  const violations = [];
  if (criticalCount <= 0) violations.push("criticalitySummary.Critical must be > 0");
  if (criticalIds.length === 0) violations.push("criticalInvariantIds must not be empty");
  if (expectedCriticalIds.length < MIN_EXPECTED_CRITICAL) {
    violations.push(`expected-invariants.json must contain at least ${MIN_EXPECTED_CRITICAL} Critical invariant(s)`);
  }
  if (missingCriticalCoverage.length > 0) {
    violations.push(`coverageGaps includes Critical invariant(s): ${missingCriticalCoverage.join(", ")}`);
  }

  console.log(`Critical invariants: ${criticalCount}`);
  console.log(`Critical IDs: ${criticalIds.join(", ") || "none"}`);
  console.log(`Status: ${violations.length === 0 ? "PASS" : "FAIL"}`);

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

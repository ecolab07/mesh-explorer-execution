#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.github/workflows';
const EXPECTED_FILE = 'conformance.yml';
const EXPECTED_PATH = join(WORKFLOWS_DIR, EXPECTED_FILE);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function listWorkflowFiles() {
  let entries = [];
  try {
    entries = readdirSync(WORKFLOWS_DIR);
  } catch {
    fail(`Missing workflows directory: ${WORKFLOWS_DIR}`);
    return [];
  }

  return entries.filter((name) => {
    if (!/\.ya?ml$/i.test(name)) return false;
    try {
      return statSync(join(WORKFLOWS_DIR, name)).isFile();
    } catch {
      return false;
    }
  });
}

function hasPattern(content, pattern) {
  return pattern.test(content);
}

function checkRequiredPattern(content, pattern, message) {
  if (!hasPattern(content, pattern)) {
    fail(message);
  }
}

const workflowFiles = listWorkflowFiles();
const conformanceFiles = workflowFiles.filter((name) => /^conformance.*\.ya?ml$/i.test(name));

if (conformanceFiles.length !== 1) {
  fail(`Multiple conformance workflows found: ${conformanceFiles.join(', ') || '(none)'}`);
}

let workflowContent = '';
try {
  workflowContent = readFileSync(EXPECTED_PATH, 'utf8');
} catch {
  fail(`Missing required workflow file: ${EXPECTED_PATH}`);
}

if (!workflowContent) {
  process.exit(process.exitCode ?? 1);
}

checkRequiredPattern(
  workflowContent,
  /(^|\n)on:\s*[\s\S]*?\bpull_request\s*:/m,
  'Missing step: trigger pull_request',
);

checkRequiredPattern(
  workflowContent,
  /(^|\n)on:\s*[\s\S]*?\bpush\s*:[\s\S]*?\bbranches\s*:\s*(\[[^\]]*\bmain\b[^\]]*\]|[\s\S]*?-\s*main\b)/m,
  'Missing step: trigger push on main',
);

checkRequiredPattern(
  workflowContent,
  /pnpm\s+install\s+--frozen-lockfile/m,
  'Missing step: pnpm install --frozen-lockfile',
);

const hasBuildStep = /pnpm\s+-r\s+build/m.test(workflowContent);
const hasBuildInTest = /pnpm\s+test/m.test(workflowContent) && /"?test"?\s*:\s*"[^"]*pnpm\s+-r\s+build/m.test(readFileSync('package.json', 'utf8'));
if (!hasBuildStep && !hasBuildInTest) {
  fail('Missing step: pnpm -r build (or build integrated in pnpm test)');
}

checkRequiredPattern(
  workflowContent,
  /pnpm\s+(?:--filter\s+@mesh\/conformance-tests\s+test|test)\b/m,
  'Missing step: pnpm test OR pnpm --filter @mesh/conformance-tests test',
);

checkRequiredPattern(
  workflowContent,
  /pnpm\s+--filter\s+@mesh\/conformance-tests\s+check:artifacts-clean\b/m,
  'Missing step: pnpm --filter @mesh/conformance-tests check:artifacts-clean',
);

checkRequiredPattern(
  workflowContent,
  /pnpm\s+--filter\s+@mesh\/conformance-tests\s+check:critical\b/m,
  'Missing step: pnpm --filter @mesh/conformance-tests check:critical',
);

if (!/uses:\s*actions\/upload-artifact@/m.test(workflowContent)) {
  fail('Missing step: upload artifacts');
}

const requiredPaths = [
  'artifacts/conformance-evidence.json',
  'artifacts/conformance-evidence.md',
  'artifacts/conformance-evidence.critical.md',
  'artifacts/conformance-evidence.runtime.json',
];
for (const requiredPath of requiredPaths) {
  if (!workflowContent.includes(requiredPath)) {
    fail(`Upload artifact path missing: ${requiredPath}`);
  }
}

if (!/github\.event_name|\$\{\{\s*github\.event_name\s*}}/.test(workflowContent)) {
  console.log('Info: no explicit github.event_name condition found (optional check skipped).');
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log('Conformance workflow validation passed.');

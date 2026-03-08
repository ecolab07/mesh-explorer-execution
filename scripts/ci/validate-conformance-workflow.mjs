#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.github/workflows';
const PRIMARY_FILE = 'conformance.yml';
const NIGHTLY_FILE = 'conformance-nightly.yml';
const ALLOWED_CONFORMANCE_FILES = [PRIMARY_FILE, NIGHTLY_FILE];

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

function readWorkflowContent(fileName) {
  const workflowPath = join(WORKFLOWS_DIR, fileName);
  try {
    return readFileSync(workflowPath, 'utf8');
  } catch {
    fail(`Missing required workflow file: ${workflowPath}`);
    return '';
  }
}

const workflowFiles = listWorkflowFiles();
const conformanceFiles = workflowFiles.filter((name) => /^conformance.*\.ya?ml$/i.test(name));

const unexpectedConformanceFiles = conformanceFiles.filter(
  (name) => !ALLOWED_CONFORMANCE_FILES.includes(name),
);

if (unexpectedConformanceFiles.length > 0) {
  fail(
    `Unexpected conformance workflow(s): ${unexpectedConformanceFiles.join(', ')}. Allowed: ${ALLOWED_CONFORMANCE_FILES.join(', ')}`,
  );
}

if (!workflowFiles.includes(PRIMARY_FILE)) {
  fail(`Missing required workflow file: ${join(WORKFLOWS_DIR, PRIMARY_FILE)}`);
}

const workflowContent = readWorkflowContent(PRIMARY_FILE);

if (!workflowContent) {
  process.exit(process.exitCode ?? 1);
}

checkRequiredPattern(
  workflowContent,
  /NODE_VERSION:\s*20\.11\.1/m,
  'Missing or unexpected NODE_VERSION pin in conformance.yml',
);

checkRequiredPattern(
  workflowContent,
  /PNPM_VERSION:\s*9\.15\.4/m,
  'Missing or unexpected PNPM_VERSION pin in conformance.yml',
);

checkRequiredPattern(
  workflowContent,
  /corepack\s+enable[\s\S]*corepack\s+prepare\s+pnpm@\$\{\{\s*env\.PNPM_VERSION\s*\}\}\s+--activate/m,
  'Missing step: corepack enable + corepack prepare pnpm@${{ env.PNPM_VERSION }} --activate',
);

checkRequiredPattern(
  workflowContent,
  /actions\/setup-node@v4[\s\S]*node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/m,
  'Missing step: actions/setup-node with env.NODE_VERSION pin',
);

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

checkRequiredPattern(
  workflowContent,
  /pnpm\s+check:lockfile-clean\b/m,
  'Missing step: pnpm check:lockfile-clean',
);

const hasBuildStep = /pnpm\s+-r\s+(?:--filter\s+@mesh\/conformance-tests(?:\.\.\.)?\s+)?build\b/m.test(workflowContent);
const hasBuildInTest = /pnpm\s+test/m.test(workflowContent) && /"?test"?\s*:\s*"[^"]*pnpm\s+-r\s+build/m.test(readFileSync('package.json', 'utf8'));
if (!hasBuildStep && !hasBuildInTest) {
  fail('Missing step: pnpm -r build OR pnpm -r --filter @mesh/conformance-tests... build (or build integrated in pnpm test)');
}

checkRequiredPattern(
  workflowContent,
  /pnpm\s+(?:(?:-r\s+)?--filter\s+@mesh\/conformance-tests(?:\.\.\.)?\s+test|test)\b/m,
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

if (workflowFiles.includes(NIGHTLY_FILE)) {
  const nightlyContent = readWorkflowContent(NIGHTLY_FILE);

  checkRequiredPattern(
    nightlyContent,
    /NODE_VERSION:\s*20\.11\.1/m,
    'Missing or unexpected NODE_VERSION pin in conformance-nightly.yml',
  );

  checkRequiredPattern(
    nightlyContent,
    /PNPM_VERSION:\s*9\.15\.4/m,
    'Missing or unexpected PNPM_VERSION pin in conformance-nightly.yml',
  );

  checkRequiredPattern(
    nightlyContent,
    /corepack\s+enable[\s\S]*corepack\s+prepare\s+pnpm@\$\{\{\s*env\.PNPM_VERSION\s*\}\}\s+--activate/m,
    'Missing step in conformance-nightly.yml: corepack enable + corepack prepare pnpm@${{ env.PNPM_VERSION }} --activate',
  );

  checkRequiredPattern(
    nightlyContent,
    /actions\/setup-node@v4[\s\S]*node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/m,
    'Missing step in conformance-nightly.yml: actions/setup-node with env.NODE_VERSION pin',
  );

  checkRequiredPattern(
    nightlyContent,
    /(^|\n)on:\s*[\s\S]*?\bschedule\s*:/m,
    'Missing step: trigger schedule in conformance-nightly.yml',
  );

  checkRequiredPattern(
    nightlyContent,
    /(^|\n)on:\s*[\s\S]*?\bworkflow_dispatch\s*:/m,
    'Missing step: trigger workflow_dispatch in conformance-nightly.yml',
  );

  if (/(^|\n)on:\s*[\s\S]*?\bpull_request\s*:/m.test(nightlyContent)) {
    fail('Forbidden trigger in conformance-nightly.yml: pull_request');
  }

  if (/(^|\n)on:\s*[\s\S]*?\bpush\s*:/m.test(nightlyContent)) {
    fail('Forbidden trigger in conformance-nightly.yml: push');
  }

  checkRequiredPattern(
    nightlyContent,
    /pnpm\s+install\s+--frozen-lockfile/m,
    'Missing step in conformance-nightly.yml: pnpm install --frozen-lockfile',
  );

  checkRequiredPattern(
    nightlyContent,
    /pnpm\s+check:lockfile-clean\b/m,
    'Missing step in conformance-nightly.yml: pnpm check:lockfile-clean',
  );

  checkRequiredPattern(
    nightlyContent,
    /pnpm\s+-r\s+(?:--filter\s+@mesh\/conformance-tests(?:\.\.\.)?\s+)?build\b/m,
    'Missing step in conformance-nightly.yml: pnpm -r build OR pnpm -r --filter @mesh/conformance-tests... build',
  );

  checkRequiredPattern(
    nightlyContent,
    /pnpm\s+(?:(?:-r\s+)?--filter\s+@mesh\/conformance-tests(?:\.\.\.)?\s+test|test)\b/m,
    'Missing step in conformance-nightly.yml: pnpm test OR pnpm --filter @mesh/conformance-tests test',
  );

  checkRequiredPattern(
    nightlyContent,
    /pnpm\s+--filter\s+@mesh\/conformance-tests\s+check:critical\b/m,
    'Missing step in conformance-nightly.yml: pnpm --filter @mesh/conformance-tests check:critical',
  );

  if (/pnpm\s+--filter\s+@mesh\/conformance-tests\s+check:artifacts-clean\b/m.test(nightlyContent)) {
    fail('Forbidden step in conformance-nightly.yml: pnpm --filter @mesh/conformance-tests check:artifacts-clean');
  }

  if (!/uses:\s*actions\/upload-artifact@/m.test(nightlyContent)) {
    fail('Missing step in conformance-nightly.yml: upload artifacts');
  }

  const nightlyRequiredPaths = ['artifacts/conformance-evidence.runtime.json', 'artifacts/chaos-stats.json'];
  for (const requiredPath of nightlyRequiredPaths) {
    if (!nightlyContent.includes(requiredPath)) {
      fail(`Upload artifact path missing in conformance-nightly.yml: ${requiredPath}`);
    }
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log('Conformance workflow validation passed.');

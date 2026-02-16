import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

function parseArgs(argv) {
  const version = argv.find((arg) => !arg.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  if (!version || !VERSION_RE.test(version)) {
    throw new Error('Usage: node scripts/release/bump-version.mjs <semver> [--dry-run]');
  }
  return { version, dryRun };
}

async function updateVersion(filePath, nextVersion, dryRun) {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const previous = parsed.version;
  if (typeof previous !== 'string') {
    throw new Error(`Missing version in ${filePath}`);
  }
  parsed.version = nextVersion;

  if (!dryRun) {
    await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  return { filePath, previous, next: nextVersion };
}

async function main() {
  const { version, dryRun } = parseArgs(process.argv.slice(2));
  const files = ['package.json'];

  const releaseTargets = [
    'packages/shared/package.json',
    'packages/eventstore-local/package.json',
    'packages/kernel-minimal/package.json',
    'packages/projection-minimal/package.json',
    'packages/snapshot-minimal/package.json',
    'packages/runtime-local/package.json',
    'packages/sync-local/package.json',
    'packages/sync-http/package.json',
    'packages/cli/package.json',
    'packages/conformance-harness/package.json',
    'packages/conformance-tests/package.json',
    'apps/mesh-notes-server/package.json',
    'apps/mesh-notes-replica/package.json',
    'apps/mesh-app/package.json'
  ];

  files.push(...releaseTargets);

  const updates = [];
  for (const relativePath of files) {
    updates.push(await updateVersion(path.normalize(relativePath), version, dryRun));
  }

  console.log(JSON.stringify({ dryRun, version, updated: updates }, null, 2));
}

main().catch((error) => {
  console.error(`[release:bump] ${error.message}`);
  process.exit(1);
});

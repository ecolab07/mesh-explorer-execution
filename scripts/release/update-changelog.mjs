import { readFile, writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const version = argv.find((arg) => !arg.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  if (!version) throw new Error('Usage: node scripts/release/update-changelog.mjs <version> [--date YYYY-MM-DD] [--dry-run]');
  const dateIndex = argv.findIndex((arg) => arg === '--date');
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : new Date().toISOString().slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid --date value, expected YYYY-MM-DD');
  return { version, date, dryRun };
}

function buildSection(version, date) {
  return [
    `## ${version} - ${date}`,
    '',
    '### Highlights',
    '- Phase 18: release workflow + hardening v1 (versioning scripts, release checklist discipline, migration readiness harness, nightly perf guardrails).',
    '- Phase 17 app skeleton remains available: notes server + replica + CLI flow are now included in integration/release docs.',
    '',
    '### Breaking changes',
    '- None (Mesh public API v1 unchanged).',
    ''
  ].join('\n');
}

async function main() {
  const { version, date, dryRun } = parseArgs(process.argv.slice(2));
  const filePath = 'CHANGELOG.md';
  const raw = await readFile(filePath, 'utf8');
  if (raw.includes(`## ${version} - `)) throw new Error(`Version ${version} already exists in ${filePath}`);
  const marker = '## Unreleased\n';
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) throw new Error('Missing "## Unreleased" section in CHANGELOG.md');
  const insertAt = markerIndex + marker.length;
  const next = `${raw.slice(0, insertAt)}\n${buildSection(version, date)}${raw.slice(insertAt)}`;
  if (!dryRun) await writeFile(filePath, next, 'utf8');
  console.log(JSON.stringify({ dryRun, filePath, version, date }, null, 2));
}

main().catch((error) => {
  console.error(`[release:changelog] ${error.message}`);
  process.exit(1);
});

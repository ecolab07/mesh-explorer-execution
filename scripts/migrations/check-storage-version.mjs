import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_SCHEMA_VERSION = 1;
const args = process.argv.slice(2);
const rootIndex = args.findIndex((arg) => arg === '--rootDir');
const rootDir = rootIndex >= 0 ? args[rootIndex + 1] : process.env.MESH_RUNTIME_ROOT_DIR ?? '.mesh-notes-data';
if (!rootDir) {
  console.error('[migrate:check] Usage: node scripts/migrations/check-storage-version.mjs [--rootDir <path>]');
  process.exit(1);
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

async function inspectJson(filePath, detector) {
  if (!(await exists(filePath))) return { status: 'missing', filePath, message: 'file not found' };
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  return detector(parsed, filePath);
}

function detectEventStoreVersion(parsed, filePath) {
  if (typeof parsed.storageSchemaVersion === 'number') {
    const ok = parsed.storageSchemaVersion === EXPECTED_SCHEMA_VERSION;
    return { status: ok ? 'ok' : 'mismatch', filePath, detected: parsed.storageSchemaVersion, expected: EXPECTED_SCHEMA_VERSION, message: ok ? 'storage schema version matches expected' : 'storage schema version mismatch; start runtime in read-only mode and migrate offline' };
  }
  if (parsed && typeof parsed === 'object' && parsed.spaces && typeof parsed.spaces === 'object') {
    return { status: 'legacy-unversioned', filePath, expected: EXPECTED_SCHEMA_VERSION, message: 'legacy layout detected (no explicit storageSchemaVersion); treated as schema v1' };
  }
  return { status: 'unknown-format', filePath, expected: EXPECTED_SCHEMA_VERSION, message: 'unknown eventstore format; fail-fast before write operations' };
}

function detectSnapshotVersion(parsed, filePath) {
  if (typeof parsed.snapshotSchemaVersion === 'number') {
    const ok = parsed.snapshotSchemaVersion === EXPECTED_SCHEMA_VERSION;
    return { status: ok ? 'ok' : 'mismatch', filePath, detected: parsed.snapshotSchemaVersion, expected: EXPECTED_SCHEMA_VERSION, message: ok ? 'snapshot schema version matches expected' : 'snapshot schema version mismatch; rebuild snapshot from event log before restart' };
  }
  if (Array.isArray(parsed?.snapshots)) {
    return { status: 'legacy-unversioned', filePath, expected: EXPECTED_SCHEMA_VERSION, message: 'legacy snapshot layout detected (no explicit snapshotSchemaVersion); treated as schema v1' };
  }
  return { status: 'unknown-format', filePath, expected: EXPECTED_SCHEMA_VERSION, message: 'unknown snapshot format; delete/rebuild snapshots before enabling writes' };
}

const reports = [
  await inspectJson(path.join(rootDir, 'eventstore', 'events.json'), detectEventStoreVersion),
  await inspectJson(path.join(rootDir, 'notes-eventstore.json'), detectEventStoreVersion),
  await inspectJson(path.join(rootDir, 'snapshots', 'snapshots.json'), detectSnapshotVersion)
];

const hasMismatch = reports.some((r) => r.status === 'mismatch' || r.status === 'unknown-format');
console.log(JSON.stringify({ expectedSchemaVersion: EXPECTED_SCHEMA_VERSION, rootDir, reports }, null, 2));
if (hasMismatch) process.exit(2);

import { mkdir, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!version) {
  console.error('[release:artifacts] Usage: node scripts/release/build-artifacts.mjs <version> [--dry-run]');
  process.exit(1);
}

const outDir = path.join('artifacts', 'release', version);
if (!dryRun) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

for (const cmd of ['pnpm -r build', `pnpm -r --filter "./packages/*" pack --pack-destination ${outDir}`]) {
  if (dryRun) console.log(`[dry-run] ${cmd}`);
  else execSync(cmd, { stdio: 'inherit' });
}

console.log(JSON.stringify({ dryRun, outDir }, null, 2));

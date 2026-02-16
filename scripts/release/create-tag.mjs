import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!version) {
  console.error('[release:tag] Usage: node scripts/release/create-tag.mjs <version> [--dry-run]');
  process.exit(1);
}

const tag = `v${version}`;
if (!dryRun) {
  const existing = execSync(`git tag --list ${tag}`, { encoding: 'utf8' }).trim();
  if (existing === tag) {
    console.error(`[release:tag] Tag ${tag} already exists`);
    process.exit(1);
  }
}

const cmd = `git tag -a ${tag} -m \"release: ${tag}\"`;
if (dryRun) console.log(`[dry-run] ${cmd}`);
else execSync(cmd, { stdio: 'inherit' });
console.log(JSON.stringify({ dryRun, tag, message: `release: ${tag}` }, null, 2));

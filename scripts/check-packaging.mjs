import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const packagesToCheck = [
  'packages/shared',
  'packages/eventstore-local',
  'packages/kernel-minimal',
  'packages/projection-minimal',
  'packages/snapshot-minimal',
  'packages/runtime-local',
  'packages/cli'
];

function collectEntrypoints(exportsField) {
  const points = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      points.push(value);
      return;
    }
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) walk(nested);
    }
  };

  walk(exportsField);
  return points;
}

async function assertPathExists(absPath, label) {
  try {
    await access(absPath);
  } catch {
    throw new Error(`${label} does not exist: ${path.relative(repoRoot, absPath)}`);
  }
}

for (const packageDir of packagesToCheck) {
  const packageJsonPath = path.join(repoRoot, packageDir, 'package.json');
  const raw = await readFile(packageJsonPath, 'utf8');
  const manifest = JSON.parse(raw);

  const entryCandidates = [manifest.main, manifest.module, manifest.types].filter(Boolean);
  const exportEntries = collectEntrypoints(manifest.exports);

  for (const value of [...entryCandidates, ...exportEntries]) {
    if (typeof value !== 'string') continue;
    if (value.includes('src/')) {
      throw new Error(`${manifest.name}: entrypoint must not reference src/: ${value}`);
    }
    if (value.startsWith('./')) {
      const abs = path.join(repoRoot, packageDir, value);
      await assertPathExists(abs, `${manifest.name} entrypoint`);
    }
  }

  if (manifest.bin) {
    const binValues = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin);
    for (const binPath of binValues) {
      if (binPath.includes('src/')) {
        throw new Error(`${manifest.name}: bin must not reference src/: ${binPath}`);
      }
      const abs = path.join(repoRoot, packageDir, binPath);
      await assertPathExists(abs, `${manifest.name} bin`);
      const binContents = await readFile(abs, 'utf8');
      if (!binContents.startsWith('#!')) {
        throw new Error(`${manifest.name}: bin is missing shebang: ${binPath}`);
      }
    }
  }
}

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/packaging-smoke/run.mjs')], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit'
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`packaging smoke test failed with exit code ${code}`));
  });
});

console.log('check:packaging ok');

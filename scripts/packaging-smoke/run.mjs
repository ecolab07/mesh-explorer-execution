import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function runNode(args, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`node ${args.join(' ')} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
  });
}

const packagesForLink = [
  'shared',
  'eventstore-local',
  'kernel-minimal',
  'projection-minimal',
  'snapshot-minimal',
  'runtime-local',
  'cli'
];

const smokeRoot = path.join(repoRoot, '.tmp', 'packaging-smoke');
await mkdir(smokeRoot, { recursive: true });
const tempProjectDir = await mkdtemp(path.join(smokeRoot, 'case-'));

try {
  await writeFile(
    path.join(tempProjectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'mesh-packaging-smoke',
        private: true,
        type: 'module'
      },
      null,
      2
    )
  );

  const meshNodeModulesDir = path.join(tempProjectDir, 'node_modules', '@mesh');
  await mkdir(meshNodeModulesDir, { recursive: true });

  for (const name of packagesForLink) {
    const linkPath = path.join(meshNodeModulesDir, name);
    const targetPath = path.join(repoRoot, 'packages', name);
    await symlink(targetPath, linkPath, 'dir');
  }

  await writeFile(
    path.join(tempProjectDir, 'consumer.mjs'),
    `import * as shared from '@mesh/shared';\nimport { createRuntimeLocal } from '@mesh/runtime-local';\n\nif (!shared || typeof createRuntimeLocal !== 'function') {\n  throw new Error('failed to resolve package exports');\n}\n\nconsole.log('esm-imports-ok');\n`
  );

  const consumerResult = await runNode([path.join(tempProjectDir, 'consumer.mjs')], tempProjectDir);

  if (!consumerResult.stdout.includes('esm-imports-ok')) {
    throw new Error(`consumer smoke did not print success marker. stdout:\n${consumerResult.stdout}`);
  }

  const cliBinPath = path.join(tempProjectDir, 'node_modules', '@mesh', 'cli', 'dist', 'bin', 'mesh.js');
  const cliResult = await runNode([cliBinPath, '--help'], tempProjectDir);

  if (!cliResult.stdout.includes('Usage: mesh')) {
    throw new Error(`cli help smoke did not print usage. stdout:\n${cliResult.stdout}`);
  }

  console.log('packaging-smoke-ok');
} finally {
  await rm(tempProjectDir, { recursive: true, force: true });
}

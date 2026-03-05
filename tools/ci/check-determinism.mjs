#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ITERATIONS = Number.parseInt(process.env.MESH_STABILITY_ITERATIONS ?? '3', 10);
const EVIDENCE_FILES = [
  'artifacts/conformance-evidence.runtime.json',
  'artifacts/conformance-evidence.critical.md',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'no-status'}): ${command} ${args.join(' ')}`);
  }
}

function hashFile(path) {
  const content = readFileSync(path);
  return createHash('sha256').update(content).digest('hex');
}

function collectHashes() {
  return Object.fromEntries(
    EVIDENCE_FILES.map((path) => {
      if (!existsSync(path)) {
        throw new Error(`Missing evidence file: ${path}`);
      }
      return [path, hashFile(path)];
    }),
  );
}

function deleteEvidenceFiles() {
  for (const path of EVIDENCE_FILES) {
    rmSync(path, { force: true });
  }
}

if (!Number.isInteger(ITERATIONS) || ITERATIONS < 2) {
  throw new Error(`MESH_STABILITY_ITERATIONS must be an integer >= 2 (got ${process.env.MESH_STABILITY_ITERATIONS ?? 'undefined'})`);
}

let baselineHashes;
for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
  console.log(`\n[determinism] Iteration ${iteration}/${ITERATIONS}`);
  deleteEvidenceFiles();

  run('pnpm', ['-r', '--filter', '@mesh/conformance-tests...', 'test']);
  run('pnpm', ['--filter', '@mesh/conformance-tests', 'posttest']);
  run('pnpm', ['--filter', '@mesh/conformance-tests', 'check:critical']);

  const hashes = collectHashes();
  for (const [file, hash] of Object.entries(hashes)) {
    console.log(`[determinism] ${file} sha256=${hash}`);
  }

  if (!baselineHashes) {
    baselineHashes = hashes;
    continue;
  }

  for (const path of EVIDENCE_FILES) {
    if (hashes[path] !== baselineHashes[path]) {
      throw new Error(
        `Determinism check failed for ${path}: baseline=${baselineHashes[path]} current=${hashes[path]} (iteration ${iteration})`,
      );
    }
  }
}

console.log(`\n[determinism] All ${ITERATIONS} iterations produced identical evidence hashes.`);

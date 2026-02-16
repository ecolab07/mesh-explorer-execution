import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const failOnRegression = args.includes('--fail-on-regression');
const outIndex = args.findIndex((arg) => arg === '--outDir');
const outDir = outIndex >= 0 ? args[outIndex + 1] : path.join('artifacts', 'perf-nightly');

const thresholds = { minTxPerSecPersistent: 180, maxReplicaCatchupMs: 2500, maxSnapshotMaintenanceMs: 2200 };

function run(scriptPath, env = {}) {
  const raw = execFileSync('node', [scriptPath], { encoding: 'utf8', env: { ...process.env, ...env } });
  const index = raw.indexOf('{');
  if (index < 0) throw new Error(`No JSON output from ${scriptPath}`);
  return JSON.parse(raw.slice(index));
}

try {
  const perf1 = run('scripts/bench/perf-1.mjs', { MESH_BENCH_BACKENDS: 'persistent', MESH_BENCH_N: process.env.MESH_BENCH_N ?? '600' });
  const replica = run('scripts/bench/replica-catchup.mjs', { MESH_REPLICA_BENCH_N: process.env.MESH_REPLICA_BENCH_N ?? '250' });
  const snapshot = run('scripts/bench/snapshot-maintenance.mjs', { MESH_SNAPSHOT_BENCH_N: process.env.MESH_SNAPSHOT_BENCH_N ?? '300' });

  const appendMs = perf1.backends?.persistent?.appendMs;
  const txCount = perf1.dataset?.N;
  if (typeof appendMs !== 'number' || typeof txCount !== 'number' || appendMs <= 0) throw new Error('Unexpected perf-1 result format');

  const metrics = {
    txPerSecPersistent: Number(((txCount / appendMs) * 1000).toFixed(2)),
    replicaCatchupMs: Number(replica.replicaCatchupMs.toFixed(2)),
    snapshotMaintenanceMs: Number(snapshot.snapshotMaintenanceMs.toFixed(2))
  };

  const checks = [
    { metric: 'txPerSecPersistent', value: metrics.txPerSecPersistent, budget: `>= ${thresholds.minTxPerSecPersistent}`, ok: metrics.txPerSecPersistent >= thresholds.minTxPerSecPersistent },
    { metric: 'replicaCatchupMs', value: metrics.replicaCatchupMs, budget: `<= ${thresholds.maxReplicaCatchupMs}`, ok: metrics.replicaCatchupMs <= thresholds.maxReplicaCatchupMs },
    { metric: 'snapshotMaintenanceMs', value: metrics.snapshotMaintenanceMs, budget: `<= ${thresholds.maxSnapshotMaintenanceMs}`, ok: metrics.snapshotMaintenanceMs <= thresholds.maxSnapshotMaintenanceMs }
  ];

  const summary = { timestamp: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? 'local', thresholds, metrics, checks, failOnRegression };
  const md = ['# Nightly perf summary', '', `- Commit: ${summary.commit}`, `- Timestamp: ${summary.timestamp}`, '', '| Metric | Value | Budget | Status |', '| --- | ---: | --- | --- |', ...checks.map((c) => `| ${c.metric} | ${c.value} | ${c.budget} | ${c.ok ? 'PASS' : 'REGRESSION'} |`), ''].join('\n');

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'nightly-perf-results.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'nightly-perf-summary.md'), md, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  if (failOnRegression && checks.some((c) => !c.ok)) process.exit(2);
} catch (error) {
  console.error(`[bench:nightly] ${error.message}`);
  process.exit(1);
}

const modules = [
  '../packages/shared/dist/index.js',
  '../packages/eventstore-local/dist/index.js',
  '../packages/kernel-minimal/dist/index.js',
  '../packages/conformance-harness/dist/index.js'
];

for (const spec of modules) {
  const mod = await import(new URL(spec, import.meta.url));
  if (!mod || typeof mod !== 'object') throw new Error(`Failed to import ${spec}`);
  console.log(`ok: ${spec}`);
}

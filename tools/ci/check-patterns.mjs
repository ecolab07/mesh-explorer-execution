#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml'
]);

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.pnpm-store',
  '.turbo',
  'artifacts',
  'coverage',
  'dist',
  'node_modules'
]);

const DEFAULT_IGNORE_FILES = new Set(['pnpm-lock.yaml']);

const DEFAULT_ALLOWLIST = ['docs/', 'artifacts/'];

const DEFAULT_PATTERNS = ['TODO\\(', 'FIXME', 'XXX'];

function parseArgs(argv) {
  const options = {
    root: '.',
    patternSources: [...DEFAULT_PATTERNS],
    allowlist: [...DEFAULT_ALLOWLIST],
    maxMatchesPerFile: 5
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = argv[++i] ?? options.root;
    } else if (arg === '--no-default-patterns') {
      options.patternSources = [];
    } else if (arg === '--pattern') {
      const value = argv[++i];
      if (value) {
        options.patternSources.push(value);
      }
    } else if (arg === '--allow') {
      const value = argv[++i];
      if (value) {
        options.allowlist.push(value);
      }
    } else if (arg === '--max-matches-per-file') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(value) && value > 0) {
        options.maxMatchesPerFile = value;
      }
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function isAllowlisted(relativePath, allowlist) {
  const normalized = relativePath.replaceAll('\\\\', '/');
  return allowlist.some((entry) => {
    const target = entry.replaceAll('\\\\', '/');
    return normalized === target || normalized.startsWith(target.endsWith('/') ? target : `${target}/`);
  });
}

async function* walk(directory, rootDir) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      yield* walk(absolutePath, rootDir);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (DEFAULT_IGNORE_FILES.has(entry.name)) {
      continue;
    }

    const ext = path.extname(entry.name);
    if (!DEFAULT_EXTENSIONS.has(ext)) {
      continue;
    }

    yield { absolutePath, relativePath };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/ci/check-patterns.mjs [--root <path>] [--no-default-patterns] [--pattern <regex>] [--allow <path-prefix>] [--max-matches-per-file <N>]');
    process.exit(0);
  }

  const rootDir = path.resolve(process.cwd(), options.root);
  const rootStats = await stat(rootDir);
  if (!rootStats.isDirectory()) {
    throw new Error(`Root path is not a directory: ${options.root}`);
  }

  const patterns = options.patternSources.map((source) => new RegExp(source, 'g'));
  const matchesByFile = new Map();

  for await (const file of walk(rootDir, rootDir)) {
    if (isAllowlisted(file.relativePath, options.allowlist)) {
      continue;
    }

    const content = await readFile(file.absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          const list = matchesByFile.get(file.relativePath) ?? [];
          if (list.length < options.maxMatchesPerFile) {
            list.push({ lineNumber: lineIndex + 1, text: line.trim(), pattern: pattern.source });
            matchesByFile.set(file.relativePath, list);
          }
        }
      }
    }
  }

  if (matchesByFile.size === 0) {
    console.log(`Pattern check passed. No matches found in ${path.relative(process.cwd(), rootDir) || '.'}.`);
    process.exit(0);
  }

  console.error(`Pattern check failed: ${matchesByFile.size} file(s) matched.`);
  for (const [file, matches] of matchesByFile) {
    console.error(`- ${path.join(options.root, file).replaceAll('\\\\', '/')}`);
    for (const match of matches) {
      console.error(`  L${match.lineNumber} [/${match.pattern}/]: ${match.text}`);
    }
    if (matches.length >= options.maxMatchesPerFile) {
      console.error(`  ... truncated to ${options.maxMatchesPerFile} match(es) for readability`);
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(`Pattern check failed with an execution error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

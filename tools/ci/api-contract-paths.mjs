import { promises as fs } from "node:fs";
import path from "node:path";

const GOLDEN_DECLARATION_RE = /^mesh__.+\.d(?:\.ts)?$/;

export function normalizeConfigPath(value) {
  return path.normalize(value);
}

export function packageSlug(name) {
  return name.replace(/^@/, "").replace(/\//g, "__");
}

export function generatedNameForPackage(name) {
  return `${packageSlug(name)}.d.ts`;
}

export async function goldenNameForPackage(name, goldenDir) {
  const normalizedGoldenDir = normalizeConfigPath(goldenDir);
  const slug = packageSlug(name);
  const dName = `${slug}.d`;
  const dTsName = `${slug}.d.ts`;

  if (await pathExists(path.join(normalizedGoldenDir, dName))) {
    return dName;
  }

  if (await pathExists(path.join(normalizedGoldenDir, dTsName))) {
    return dTsName;
  }

  return dTsName;
}

export function isGoldenDeclarationFile(name) {
  return GOLDEN_DECLARATION_RE.test(name);
}

export function isIndexTextFile(name) {
  return name === "INDEX" || name === "INDEX.txt";
}

export function stripIndexExtension(name) {
  return isIndexTextFile(name) ? "INDEX" : name;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

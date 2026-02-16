import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageName = "@rollup/rollup-win32-x64-msvc";

function hasWindowsRollup() {
  try {
    require(packageName);
    return true;
  } catch {
    return false;
  }
}

if (process.platform !== "win32") {
  console.log("not needed");
  process.exit(0);
}

if (hasWindowsRollup()) {
  console.log(`${packageName} is already available.`);
  process.exit(0);
}

console.log(`${packageName} is missing. Running pnpm install --prefer-frozen-lockfile --force...`);
const install = spawnSync("pnpm", ["install", "--prefer-frozen-lockfile", "--force"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

if (hasWindowsRollup()) {
  console.log(`${packageName} is now available.`);
  process.exit(0);
}

console.error(
  `${packageName} is still missing after forced install. As a last resort, a clean install may be required.`
);
process.exit(1);

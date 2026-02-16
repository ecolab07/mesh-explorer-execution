import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packages = ["@rollup/rollup-win32-x64-msvc", "@esbuild/win32-x64"];

function findMissingWindowsPackages() {
  return packages.filter((packageName) => {
    try {
      require(packageName);
      return false;
    } catch {
      return true;
    }
  });
}

if (process.platform !== "win32") {
  console.log("not needed");
  process.exit(0);
}

let missingPackages = findMissingWindowsPackages();
if (missingPackages.length === 0) {
  console.log(`Windows native optional packages are already available: ${packages.join(", ")}.`);
  process.exit(0);
}

console.log(
  `Missing Windows native optional packages (${missingPackages.join(", ")}). Running pnpm install --prefer-frozen-lockfile --force...`
);
const install = spawnSync("pnpm", ["install", "--prefer-frozen-lockfile", "--force"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

missingPackages = findMissingWindowsPackages();
if (missingPackages.length === 0) {
  console.log(`Windows native optional packages are now available: ${packages.join(", ")}.`);
  process.exit(0);
}

console.error(
  `Windows native optional packages are still missing after forced install: ${missingPackages.join(", ")}. As a last resort, a clean install may be required.`
);
process.exit(1);

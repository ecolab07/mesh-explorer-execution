import { execSync } from "node:child_process";

execSync("git update-index -q --refresh", { stdio: "inherit" });

try {
  execSync("git diff --exit-code -- pnpm-lock.yaml", { stdio: "inherit" });
} catch {
  process.stderr.write(
    "pnpm-lock.yaml changed after install. Run `pnpm install --no-frozen-lockfile` and commit the updated lockfile.\n"
  );
  process.exit(1);
}

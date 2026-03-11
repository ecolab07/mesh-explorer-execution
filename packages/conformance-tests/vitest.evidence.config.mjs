import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import baseConfig from "./vitest.config.mjs";
import EvidenceMetaReporter from "./scripts/evidence-meta-reporter.mjs";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(
  baseConfig,
  defineConfig({
    root: packageRoot,
    test: {
      include: ["src/**/*.test.ts"],
      reporters: ["default", new EvidenceMetaReporter()]
    }
  })
);

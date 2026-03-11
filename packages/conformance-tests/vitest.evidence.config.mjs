import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.mjs";
import EvidenceMetaReporter from "./scripts/evidence-meta-reporter.mjs";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      reporters: ["default", new EvidenceMetaReporter()]
    }
  })
);

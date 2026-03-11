import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export const conformanceVitestConfig = {
  test: {
    environment: "node"
  },
  resolve: {
    preserveSymlinks: true
  },
  server: {
    deps: {
      inline: [/^@mesh\//]
    },
    fs: {
      allow: [resolve(__dirname, ".."), resolve(__dirname, "../..")]
    }
  }
};

export default defineConfig(conformanceVitestConfig);

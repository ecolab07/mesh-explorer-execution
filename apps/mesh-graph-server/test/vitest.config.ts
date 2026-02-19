import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [resolve(__dirname, "root-route-auth.test.ts"), resolve(__dirname, "graph-mutations.test.ts")]
  },
  resolve: {
    alias: {
      "@mesh/shared": resolve(__dirname, "../../../packages/shared/src/index.ts"),
      "@mesh/eventstore-local": resolve(__dirname, "../../../packages/eventstore-local/src/index.ts"),
      "@mesh/kernel-minimal": resolve(__dirname, "../../../packages/kernel-minimal/src/index.ts"),
      "@mesh/sync-http": resolve(__dirname, "../../../packages/sync-http/src/index.ts"),
      "@mesh/sync-local/internal": resolve(__dirname, "../../../packages/sync-local/src/internal/index.ts")
    }
  }
});

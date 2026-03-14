import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@mesh/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@mesh/eventstore-local": resolve(__dirname, "../../packages/eventstore-local/src/index.ts"),
      "@mesh/kernel-minimal": resolve(__dirname, "../../packages/kernel-minimal/src/index.ts"),
      "@mesh/sync-http": resolve(__dirname, "../../packages/sync-http/src/index.ts"),
      "@mesh/sync-local": resolve(__dirname, "../../packages/sync-local/src/index.ts")
    }
  }
});

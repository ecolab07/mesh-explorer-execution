import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mesh/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@mesh/kernel-minimal": path.resolve(__dirname, "../kernel-minimal/src/index.ts"),
      "@mesh/eventstore-local": path.resolve(__dirname, "../eventstore-local/src/index.ts"),
      "@mesh/projection-minimal": path.resolve(__dirname, "../projection-minimal/src/index.ts"),
      "@mesh/snapshot-minimal": path.resolve(__dirname, "../snapshot-minimal/src/index.ts")
    }
  }
});

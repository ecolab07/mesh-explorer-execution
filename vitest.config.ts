import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mesh/shared": `${root}packages/shared/src/index.ts`,
      "@mesh/eventstore-local": `${root}packages/eventstore-local/src/index.ts`,
      "@mesh/kernel-minimal": `${root}packages/kernel-minimal/src/index.ts`,
      "@mesh/sync-http": `${root}packages/sync-http/src/index.ts`
    }
  }
});

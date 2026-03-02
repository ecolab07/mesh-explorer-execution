import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },

  resolve: {
    preserveSymlinks: true,
  },

  server: {
    deps: {
      inline: [/^@mesh\//],
    },
    fs: {
      allow: [
        resolve(__dirname, ".."),
        resolve(__dirname, "../.."),
      ],
    },
  },
});
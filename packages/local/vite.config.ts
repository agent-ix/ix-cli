/// <reference types="vitest" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true, include: ["src"] })],
  build: {
    lib: {
      entry: "src/index.ts",
      fileName: () => "index.js",
      formats: ["es"],
    },
    target: "node18",
    rollupOptions: {
      external: [
        /^node:/,
        "@agent-ix/ix-ui-cli",
        "@clack/prompts",
        "cli-table3",
        "commander",
        "execa",
        "listr2",
        "picocolors",
        "yaml",
      ],
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});

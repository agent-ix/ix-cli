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
        "@agent-ix/ix-cli-core",
        "@clack/prompts",
        "execa",
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

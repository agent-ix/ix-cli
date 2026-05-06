/// <reference types="vitest" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true, include: ["src"] })],
  build: {
    lib: {
      entry: "src/index.tsx",
      fileName: () => "index.js",
      formats: ["es"],
    },
    target: "node18",
    rollupOptions: {
      external: [
        /^node:/,
        /^react($|\/)/,
        "@agent-ix/ix-ui-cli",
        "@agent-ix/ix-cli-core",
        "@clack/prompts",
        "cli-table3",
        "commander",
        "execa",
        "listr2",
        "picocolors",
        "yaml",
        "zod",
        "age-encryption",
        "@napi-rs/keyring",
        /^@napi-rs\/keyring-/,
      ],
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});

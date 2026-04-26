import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: {
        "commands/up": "src/commands/up.ts",
        "commands/down": "src/commands/down.ts",
        "commands/list": "src/commands/list.ts",
        "commands/local/up": "src/commands/local/up.ts",
        "commands/local/down": "src/commands/local/down.ts",
        "commands/local/list": "src/commands/local/list.ts",
        "commands/local/refresh": "src/commands/local/refresh.ts",
        "commands/local/init-cluster": "src/commands/local/init-cluster.ts",
        "commands/local/init": "src/commands/local/init.ts",
        "commands/local/cluster/up": "src/commands/local/cluster/up.ts",
        "commands/local/cluster/down": "src/commands/local/cluster/down.ts",
        "commands/local/cluster/status": "src/commands/local/cluster/status.ts",
        "commands/local/auth/reset-admin":
          "src/commands/local/auth/reset-admin.ts",
        "commands/local/auth/invite": "src/commands/local/auth/invite.ts",
        "commands/local/auth/reset-user":
          "src/commands/local/auth/reset-user.ts",
        "commands/local/auth/config/email/enable":
          "src/commands/local/auth/config/email/enable.ts",
        "commands/local/auth/config/email/disable":
          "src/commands/local/auth/config/email/disable.ts",
        "commands/local/auth/config/email/show":
          "src/commands/local/auth/config/email/show.ts",
        "commands/local/auth/config/email/test":
          "src/commands/local/auth/config/email/test.ts",
        "commands/local/auth/config/password-reset/set":
          "src/commands/local/auth/config/password-reset/set.ts",
        "commands/local/auth/config/password-reset/show":
          "src/commands/local/auth/config/password-reset/show.ts",
        "commands/local/auth/config/social/add":
          "src/commands/local/auth/config/social/add.ts",
        "commands/local/auth/config/social/remove":
          "src/commands/local/auth/config/social/remove.ts",
        "commands/local/auth/config/social/list":
          "src/commands/local/auth/config/social/list.ts",
        "commands/local/auth/config/social/show":
          "src/commands/local/auth/config/social/show.ts",
        "commands/local/auth/config/registration/set":
          "src/commands/local/auth/config/registration/set.ts",
        "commands/local/auth/config/registration/show":
          "src/commands/local/auth/config/registration/show.ts",
        "commands/plugin/install": "src/commands/plugin/install.ts",
        "commands/plugin/remove": "src/commands/plugin/remove.ts",
        "commands/plugin/list": "src/commands/plugin/list.ts",
        "hooks/init": "src/hooks/init.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@agent-ix/ix-cli-local",
        "@agent-ix/ix-cli-core",
        "@agent-ix/ix-ui-cli",
        "@oclif/core",
        "picocolors",
        /^node:/,
      ],
    },
  },
  plugins: [dts({ insertTypesEntry: true })],
});

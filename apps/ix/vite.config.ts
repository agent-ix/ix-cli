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
        "commands/local/halt": "src/commands/local/halt.ts",
        "commands/local/list": "src/commands/local/list.ts",
        "commands/local/refresh": "src/commands/local/refresh.ts",
        "commands/local/init": "src/commands/local/init.ts",
        "commands/local/status": "src/commands/local/status.ts",
        "commands/local/cluster/down": "src/commands/local/cluster/down.ts",
        "commands/local/cluster/start": "src/commands/local/cluster/start.ts",
        "commands/local/cluster/stop": "src/commands/local/cluster/stop.ts",
        "commands/local/cluster/status": "src/commands/local/cluster/status.ts",
        "commands/local/cluster/refresh-cert":
          "src/commands/local/cluster/refresh-cert.ts",
        "commands/local/admin-reset": "src/commands/local/admin-reset.ts",
        "commands/local/auth/reset-admin":
          "src/commands/local/auth/reset-admin.ts",
        "commands/local/auth/invite": "src/commands/local/auth/invite.ts",
        "commands/local/auth/uninvite": "src/commands/local/auth/uninvite.ts",
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
        "commands/update": "src/commands/update.tsx",
        "commands/elements/list": "src/commands/elements/list.ts",
        "commands/elements/init": "src/commands/elements/init.ts",
        "commands/elements/new": "src/commands/elements/new.ts",
        "commands/elements/tap/add": "src/commands/elements/tap/add.ts",
        "commands/elements/tap/remove": "src/commands/elements/tap/remove.ts",
        "commands/elements/tap/list": "src/commands/elements/tap/list.ts",
        "commands/config/get": "src/commands/config/get.ts",
        "commands/config/set": "src/commands/config/set.ts",
        "commands/config/edit": "src/commands/config/edit.ts",
        "commands/config/doctor": "src/commands/config/doctor.ts",
        "commands/secrets/list": "src/commands/secrets/list.ts",
        "commands/secrets/set": "src/commands/secrets/set.ts",
        "commands/secrets/rm": "src/commands/secrets/rm.ts",
        "commands/secrets/which": "src/commands/secrets/which.ts",
        "commands/tunnel/up": "src/commands/tunnel/up.ts",
        "commands/tunnel/down": "src/commands/tunnel/down.ts",
        "commands/tunnel/status": "src/commands/tunnel/status.ts",
        "commands/tunnel/expose": "src/commands/tunnel/expose.ts",
        "commands/tunnel/unexpose": "src/commands/tunnel/unexpose.ts",
        "commands/tunnel/domain": "src/commands/tunnel/domain.ts",
        "commands/workflow/create": "src/commands/workflow/create.ts",
        "commands/workflow/status": "src/commands/workflow/status.ts",
        "commands/workflow/advance": "src/commands/workflow/advance.ts",
        "commands/workflow/add-item": "src/commands/workflow/add-item.ts",
        "commands/workflow/update-item": "src/commands/workflow/update-item.ts",
        "commands/workflow/link-items": "src/commands/workflow/link-items.ts",
        "commands/workflow/ack": "src/commands/workflow/ack.ts",
        "commands/workflow/history": "src/commands/workflow/history.ts",
        "commands/workflow/verify-chain":
          "src/commands/workflow/verify-chain.ts",
        "hooks/init": "src/hooks/init.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        /^react($|\/)/,
        "@agent-ix/ix-cli-local",
        "@agent-ix/ix-cli-core",
        "@agent-ix/ix-cli-elements",
        "@agent-ix/ix-ui-cli",
        "@agent-ix/workflow-cli-plugin",
        "@oclif/core",
        "picocolors",
        /^node:/,
      ],
    },
  },
  plugins: [dts({ insertTypesEntry: true })],
});

import { Hook } from "@oclif/core";
import { loadPlugins } from "@agent-ix/ix-cli-core";

const hook: Hook<"init"> = async function (opts) {
  try {
    const plugins = await loadPlugins();
    for (const plugin of plugins) {
      for (const _cmd of plugin.commands()) {
        // Register dynamic commands from installed plugins.
        // oclif v4 config.plugins is a Map<string, Plugin>; set by plugin name.
        const entry: Record<string, unknown> = {
          name: plugin.name,
          version: plugin.version,
          type: "user",
        };
        (opts.config.plugins as unknown as Map<string, unknown>).set(
          plugin.name,
          entry,
        );
      }
    }
  } catch {
    // Plugin load errors must never crash the CLI.
  }
};

export default hook;

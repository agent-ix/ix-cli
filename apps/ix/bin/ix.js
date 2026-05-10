#!/usr/bin/env node

import { execute } from "@oclif/core";

const cleanedArgv = [process.argv[0], process.argv[1]];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--config-root") {
    process.env.IX_RUNTIME_CONFIG_ROOT_FLAG = process.argv[i + 1] ?? "";
    i++;
    continue;
  }
  if (arg.startsWith("--config-root=")) {
    process.env.IX_RUNTIME_CONFIG_ROOT_FLAG = arg.slice(
      "--config-root=".length,
    );
    continue;
  }
  if (arg === "--no-project-config") {
    process.env.IX_RUNTIME_NO_PROJECT_CONFIG = "1";
    continue;
  }
  cleanedArgv.push(arg);
}
process.argv = cleanedArgv;

await execute({ development: false, dir: import.meta.url });

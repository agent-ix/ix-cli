import { Hook } from "@oclif/core";

/**
 * oclif `init` hook. Reserved for future plugin / schema registration
 * (slice 10 of the config-secrets work) — currently a no-op now that
 * the legacy plugin-loader path has been removed.
 */
const hook: Hook<"init"> = async function () {
  // Intentionally empty.
};

export default hook;

---
id: FR-025
title: ixSchema Plugin Convention
type: functional-requirement
related:
  - StR-008
  - US-012
  - FR-021
---
# FR-025 ixSchema Plugin Convention

An IX-compatible plugin SHALL be a normal oclif plugin npm package. If
the plugin needs namespaced config, secrets, or environment-variable
bindings, it SHALL expose them through a single `ixSchema` named export
from its package main.

The host CLI's `init` hook (provided by `@agent-ix/ix-cli-core`) SHALL
walk `Config.plugins` (oclif's loaded plugin list), read each plugin's
`ixSchema` if present, and register the schemas through `ConfigService`
and `SecretsService` using the plugin's npm package name as the
namespace.

## Acceptance Criteria

- FR-025-AC-1: `IxPluginSchema` is a small TypeScript type exported from
  `@agent-ix/ix-cli-core` containing optional `config` (Zod object),
  optional `secrets` (Zod object or secret declaration list), and
  optional `env` (string-to-string env-var binding map).
- FR-025-AC-2: Plugin packages export `ixSchema: IxPluginSchema` from
  their package main when they need any of those bindings.
- FR-025-AC-3: The host's `init` hook reads `Config.plugins`, dynamic
  imports each plugin's main, and calls
  `registerPluginSchema(plugin.name, mod.ixSchema)` when an `ixSchema`
  export exists.
- FR-025-AC-4: Config schemas must be strict (`z.object({...}).strict()`);
  non-strict schemas are rejected and the plugin's config is not
  registered.
- FR-025-AC-5: Secrets declarations are registered through the existing
  `SecretsService` registry using `<package-name>.<secret-name>`.
- FR-025-AC-6: A plugin with no `ixSchema` export is a valid oclif plugin
  — it contributes commands and nothing else.
- FR-025-AC-7: Capability declarations live on individual command
  classes (see FR-024), not on the `ixSchema` object.

## Convention shape

```ts
// in @agent-ix/ix-cli-core
export interface IxPluginSchema {
  config?: ZodObject<ZodRawShape>;   // strict
  secrets?: SecretDeclaration[];
  env?: Record<string, string>;
}

// in a plugin package's main
import type { IxPluginSchema } from "@agent-ix/ix-cli-core";
import { z } from "zod";

export const ixSchema: IxPluginSchema = {
  config: z.object({ stateDir: z.string().default(".workflow") }).strict(),
  secrets: [{ name: "github-token", required: false }],
  env: { stateDir: "IX_WORKFLOW_STATE_DIR" },
};
```

## Notes

The earlier draft of FR-025 defined an `IxPlugin` interface and
`registerIxPlugin()` runtime registry that duplicated oclif's plugin
discovery (`id`, `commands` registration) and required a parallel
manifest-loader to resolve which `IxPlugin` objects were active.

That registry has been deleted. Plugin identity is the npm package
name. Plugin command discovery is oclif's. The only IX-specific shape
is the `ixSchema` named export — a much smaller convention than a fat
registration contract.

## Errors

- `invalid-package-name` — schema registered with a malformed package name
- `non-strict-schema` — config schema is not strict
- `duplicate-registration` — same package name registered twice (the
  first registration is preserved and the second returns a non-throwing
  failure result)
- `secret-registration-failed` — secret declaration failed validation

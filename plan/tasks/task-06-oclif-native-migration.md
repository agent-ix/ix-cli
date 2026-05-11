# Task 06 — Migrate ix-cli to oclif-native plugins

Status: active
Supersedes: task-01, task-02, task-03, task-05; partially reuses task-04.

## Why

A design review concluded that the custom `IxPlugin` runtime introduced in
`c5ac413` and `1bbcf9c` duplicates oclif's native plugin system. The
"manifest must be read before plugin discovery" constraint that justified
the bypass in `apps/ix/bin/ix.js` was self-imposed and is no longer needed
(the per-project plugin enable/disable feature it enabled has been
explicitly dropped). See the follow-up review in
`spec/reviews/runtime-plugin-addendum-review.md`.

## Sub-tasks (in dependency order)

### 06.A Delete the custom plugin layer

**Remove:**

- `packages/core/src/plugins/registry.ts` and its tests
- `packages/core/src/plugins/types.ts` `IxPlugin` interface (keep the
  module file if other types still live there)
- `packages/core/src/runtime/manifest.ts` and its tests
- `packages/core/src/runtime/distribution.ts` (only its bypass role is
  going away; if other code still consumes it, slim it to just config
  defaults)
- `apps/ix/bin/ix.js` argv preprocessing block
- `apps/ix/src/hooks/init.ts` mutation of `Command.baseFlags`
- `apps/ix/src/distribution.ts` (collapse remaining defaults into
  `core` plugin config and `apps/ix/package.json`)

**Keep:** `packages/core/src/runtime/capabilities.ts` — the
`CapabilityResolver` is fine; it just needed a consumer.

### 06.B Add `BaseCommand`

New file `apps/ix/src/base-command.ts` (or in `@agent-ix/ix-cli-core` if
that lib is the right home — see decision in 06.B-1 below). Owns:

- `static baseFlags = { 'config-root': Flags.string({...}),`
  ` 'no-project-config': Flags.boolean({ default: false }) }`
- `static capabilities?: CommandCapabilities`
- `async init()` — derives runtime context from the inherited
  `--config-root` base flag in normal oclif command-flag position,
  `IX_CONFIG_ROOT` env, and XDG default; assigns the resolved root to
  `getRuntimeContext()`.
- `async prerun()` — reads `static capabilities` on subclass; invokes
  `CapabilityResolver`; short-circuits with structured error if any
  required capability is unavailable.

#### 06.B-1 Where does `BaseCommand` live?

Two viable answers:

- **In `@agent-ix/ix-cli-core`** (preferred) — every IX CLI imports it.
  Lets `ix-agent-skills` plugin commands extend it directly without a
  per-distribution shim.
- **In `apps/ix/src/`** — slightly simpler short-term, but pushes the
  same boilerplate into every other IX CLI binary.

Default: `@agent-ix/ix-cli-core`. If circular-dep concerns arise (the
core lib importing oclif `Command`), keep the dep one-way: core has
`peerDependencies: { "@oclif/core": ">=4" }`.

### 06.C Static plugin list

**File**: `apps/ix/package.json`

- Add built-in plugin packages to `oclif.plugins`:
  `@agent-ix/ix-cli-elements`, `@agent-ix/ix-cli-local`,
  `@agent-ix/workflow-cli-plugin`. Their commands stop being registered
  via `registerIxPlugin` and start being discovered by oclif.
- Leave the workflow plugin's `link:` dep alone — `build-chain --stable`
  converts it.

### 06.D `ixSchema` registration pass

**File**: `apps/ix/src/hooks/init.ts` (replaces the deleted block)

```ts
import { registerPluginSchema } from '@agent-ix/ix-cli-core';

export const hook: Hook<'init'> = async function (opts) {
  for (const plugin of opts.config.plugins) {
    const mod = await import(plugin.root);
    if (mod.ixSchema) {
      registerPluginSchema(plugin.name, mod.ixSchema);
    }
  }
};
```

New module `packages/core/src/plugins/schema.ts`:

- `IxPluginSchema` interface (`config`, `secrets`, `env`)
- `registerPluginSchema(packageName, schema)` — validates strict schema
  and adds to a process-level registry consulted by
  `ConfigService.forPlugin(schema.id ?? derivedPackageId)`.

### 06.E Honor `--config-root` in `elements/`

- `packages/elements/src/registry/cache.ts:6` — replace
  `path.join(os.homedir(), '.cache', 'ix', 'elements')` with
  `cacheRoot()` from `packages/core/src/config/paths.ts` (add the helper
  if absent).
- `packages/elements/src/tap-config.ts:6-10` — replace `os.homedir()`
  join with `path.join(configRoot(), 'elements-taps.yaml')`.

Both files become functions of the resolved runtime context, not
module-level constants.

### 06.F Per-command capabilities

For each command class that touches a service:

- Workflow commands needing GitHub, IX API, or review-service: add
  `static capabilities = { required: ['github'], optional: ['ix-api'] }`
  (adjust per command).
- Elements tap commands: `static capabilities = { optional: ['github'] }`.
- Local commands: declare per current `distribution.ts` requires.

Verify `BaseCommand.prerun` short-circuits with `capability_missing`
when a required capability is unavailable.

## Test plan

- TC-500 / TC-501: integration tests that `Config.plugins` contains the
  declared packages.
- TC-503–TC-507: command tests for `--config-root` precedence and
  precedence rules.
- TC-508: static check `--help` lists `--config-root` and
  `--no-project-config`.
- TC-509: static check that `bin/ix.js` does not preprocess argv.
- TC-510: static check no `plugins.yaml` reads exist in the runtime.
- TC-512–TC-515: command tests for capability guard end-to-end.
- TC-600–TC-606: ixSchema registry unit + integration tests.

## Exit criteria

- All revised TCs in `spec/tests.md` pass.
- `node apps/ix/bin/ix.js --help` shows `--config-root` natively.
- `apps/ix/bin/ix.js` is 2-3 lines (the oclif boot) with no argv
  preprocessing.
- `packages/core/src/runtime/manifest.ts` and `plugins/registry.ts`
  are deleted.
- `elements` reads/writes track `--config-root`.

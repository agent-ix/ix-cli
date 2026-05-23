---
id: FR-013
title: "Plugin Schema Registration via IxPlugin"
artifact_type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-005"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-010"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/core/FR-014"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

The `IxPlugin` interface exported from `@agent-ix/ix-cli-core` SHALL be extended with two optional fields:

```typescript
interface IxPlugin {
  id: string;
  // ...existing fields (commands, requires, etc.)
  configSchema?: ZodObject<ZodRawShape>;  // MUST be Zod .strict()
  secretsSchema?: SecretDeclaration[];
}

interface SecretDeclaration {
  name: string;                            // local name; full id is "<pluginId>.<name>"
  description: string;                     // shown by `ix secrets list` and prompts
  required?: boolean;                      // when true, ix login flow will prompt
  envVar?: string;                         // optional env binding (e.g. "IX_GHCR_TOKEN")
}
```

**Registration.** `apps/ix/src/hooks/init.ts` SHALL walk every loaded plugin and:

1. If `configSchema` is present, register it with the global `ConfigService` registry under `plugin.id`. The schema MUST be `.strict()`.
2. If `secretsSchema` is present, register each entry with the global `SecretsService` registry as `<plugin.id>.<entry.name>`.
3. Reject duplicate registrations under the same `id`.
4. Reject any third-party plugin using the reserved id `core`.

**Init failure isolation.** Every registration failure (non-strict schema, duplicate id, reserved-id misuse) SHALL be **logged and skipped**, NOT thrown. The offending plugin is excluded from the registry; other plugins continue to load; startup succeeds. The failure is recorded for surfacing by `ix config doctor` and `ix --version --verbose`. A `PluginRegistrationError` value type carries the failure reason but is captured by the registration loop, never propagated to the process boundary.

**Schema scoping.** A plugin's schema is in scope only when that plugin's commands or services run; it is not exposed as a global type. Cross-plugin schema introspection is deliberately not provided.

## Acceptance

- **FR-013-AC-1**: A plugin declaring `configSchema: z.object({ tags: z.array(z.string()) }).strict()` makes `ConfigService.forPlugin(plugin.id, …)` validate writes against that schema.
- **FR-013-AC-2**: A plugin declaring a non-strict `configSchema` (`.passthrough()` or no `.strict()`) is logged and skipped — its registration is rejected, the failure is recorded for `ix config doctor`, and other plugins continue to load. Process exit code is unchanged.
- **FR-013-AC-3**: Given two plugins with the same `id`, only the first registers; the second is logged and skipped. Both events are reported by `ix config doctor`.
- **FR-013-AC-4**: A third-party plugin attempting to register under id `core` is logged and skipped; the legitimate `core` registration owned by `apps/ix` is preserved.
- **FR-013-AC-5**: For every registration failure (AC-2/3/4), `ix config doctor` SHALL surface the failed plugin id, the failure reason (`non-strict-schema` / `duplicate-id` / `reserved-id-core`), and the plugin's discovery source (npm package name + version).
- **FR-013-AC-6**: A `secretsSchema` entry with `envVar: "IX_FOO"` causes `SecretsService.get('<id>.foo')` to honor `IX_FOO` ahead of any persisted backend (per FR-014 resolution order).
- **FR-013-AC-7** *(plugin id constraint)*: `IxPlugin.id` SHALL match the regex `^[a-z][a-z0-9-]*$` (lowercase ASCII, starts with a letter, letters/digits/hyphens only, length ≤ 64). The id is used as a filename component for `config.d/<id>.yaml` and `secrets.d/<id>.age`; this constraint prevents path-traversal characters (`/`, `..`, `\`), shell-special characters, and empty ids from ever reaching the filesystem. A registration whose `id` violates the regex is logged and skipped (per AC-2/3/4 init-failure isolation), with reason `invalid-plugin-id`.

## Endpoint

> TODO: document the endpoint as a `| Method | Path | Auth | Description |` table.


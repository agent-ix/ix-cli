---
id: FR-020
title: "Core Plugin Schema (configSchema and secretsSchema for id `core`)"
type: FR
object: configuration
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-004"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-003"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

The reserved `core` plugin (owned by `apps/ix`, registered via the same `ixSchema` plugin contract as any other plugin — see `ix://agent-ix/ix-cli-core/FR-004`, `ix://agent-ix/ix-cli-core/FR-014`) SHALL declare the following `configSchema` and `secretsSchema`. These schemas form the v1 contract for `~/.config/ix/config.yaml` (the reserved-`core` file-layout carve-out defined in `ix://agent-ix/ix-cli-core/FR-001`) and for the `core.*` secrets namespace. This requirement is IX-specific: it fixes the concrete keys IX's `ix` binary persists; the generic config/secrets machinery is specified in ix-cli-core.

### configSchema (Zod, `.strict()`)

```typescript
const CoreConfigSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  secretsBackend: z.enum(['auto', 'keyring', 'age-file']).default('auto'),

  auth: z.object({
    serviceUrl: z.string().url().default('https://auth.ix'),
    expiresAt: z.string().datetime().optional(),   // ISO-8601, written by `ix login`
  }).strict().default({}),

  telemetry: z.object({
    enabled: z.boolean().default(false),           // opt-in, default off
  }).strict().default({}),

  theme: z.enum(['auto', 'light', 'dark']).default('auto'),

  updateCheck: z.object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().int().min(1).max(168).default(24),
  }).strict().default({}),
}).strict();
```

**Env-var bindings.** Every leaf key SHALL declare an `IX_*` env var binding for the layered resolution defined in `ix://agent-ix/ix-cli-core/FR-003`:

| Key | Env var |
|---|---|
| `logLevel` | `IX_LOG_LEVEL` |
| `secretsBackend` | `IX_SECRETS_BACKEND` |
| `auth.serviceUrl` | `IX_AUTH_URL` |
| `telemetry.enabled` | `IX_TELEMETRY` |
| `theme` | `IX_THEME` |
| `updateCheck.enabled` | `IX_UPDATE_CHECK` |
| `updateCheck.intervalHours` | `IX_UPDATE_CHECK_INTERVAL_HOURS` |

`auth.expiresAt` has no env binding — it is written by `ix login` and read by token-refresh logic.

### secretsSchema

```typescript
const CoreSecretsSchema: SecretDeclaration[] = [
  { name: 'github-token',       description: 'GitHub OAuth access token (device-flow login)', envVar: 'IX_GITHUB_TOKEN' },
  { name: 'auth-access-token',  description: 'IX auth-service access token',                  envVar: 'IX_AUTH_ACCESS_TOKEN' },
  { name: 'auth-refresh-token', description: 'IX auth-service refresh token',                                                  },
];
```

Resulting `SecretId`s: `core.github-token`, `core.auth-access-token`, `core.auth-refresh-token`.

### Out of scope for v1

Cluster-targeting state (which cluster, kubeconfig context) lives in the `local` plugin's schema for v1, NOT in `core`. Promotion of cluster targeting to `core` is tracked in [agent-ix/ix-cli#2](https://github.com/agent-ix/ix-cli/issues/2) and is gated on hosted Agent IX clusters landing.

Other deferred core fields: proxy settings, default editor, default output format. These can be added as additive non-breaking schema changes in later versions.

## Configuration

| Name | Scope | Type | Default | Description |
|---|---|---|---|---|
| `logLevel` | runtime | enum (debug, info, warn, error) | `info` | Core log level; env binding `IX_LOG_LEVEL`. |
| `secretsBackend` | runtime | enum (auto, keyring, age-file) | `auto` | Secrets backend selection; `auto` picks keyring when the FR-015 probe succeeds, age-file otherwise; env binding `IX_SECRETS_BACKEND`. |
| `auth.serviceUrl` | runtime | string (URL) | `https://auth.ix` | IX auth-service URL; env binding `IX_AUTH_URL`. |
| `auth.expiresAt` | runtime | string (ISO-8601 datetime), optional | (unset) | Token expiry written by `ix login`, read by token-refresh logic; the only core key with no env binding. |
| `telemetry.enabled` | runtime | boolean | `false` | Telemetry opt-in (default off); env binding `IX_TELEMETRY`. |
| `theme` | runtime | enum (auto, light, dark) | `auto` | UI theme; env binding `IX_THEME`. |
| `updateCheck.enabled` | runtime | boolean | `true` | Update-check toggle; env binding `IX_UPDATE_CHECK`. |
| `updateCheck.intervalHours` | runtime | integer (1–168) | `24` | Hours between update checks; env binding `IX_UPDATE_CHECK_INTERVAL_HOURS`. |

## Acceptance

- **FR-020-AC-1**: `ConfigService.forPlugin('core', CoreConfigSchema).get()` against an empty environment and absent `~/.config/ix/config.yaml` returns the full default object: `logLevel: 'info'`, `secretsBackend: 'auto'`, `auth: { serviceUrl: 'https://auth.ix' }`, `telemetry: { enabled: false }`, `theme: 'auto'`, `updateCheck: { enabled: true, intervalHours: 24 }`.
- **FR-020-AC-2**: Setting any leaf key via the corresponding env var (per the table above) takes precedence over the file value (verified by the `ix://agent-ix/ix-cli-core/FR-003`-AC-1 mechanism).
- **FR-020-AC-3**: `secretsBackend = 'auto'` selects keyring when the `ix://agent-ix/ix-cli-core/FR-006` capability probe succeeds, age-file when it fails (per `ix://agent-ix/ix-cli-core/FR-005` active-backend selection).
- **FR-020-AC-4**: `secretsBackend = 'keyring'` pinned with a failing probe causes every `SecretsService` operation to throw `KeyringUnavailableError` (per `ix://agent-ix/ix-cli-core/NFR-004`-AC-5).
- **FR-020-AC-5**: An attempt to set an unknown key in `~/.config/ix/config.yaml` (e.g. `cluster.context`) is rejected by the `.strict()` schema with a four-tuple error per `ix://agent-ix/ix-cli-core/NFR-003`, naming `core` as the plugin and pointing the user to `ix config doctor`. (`cluster.*` belongs to `local`, not `core`.)
- **FR-020-AC-6**: Each `SecretId` enumerated above is registered with `SecretsService` at startup and appears in `ix secrets list` with its declared description and (where present) `envVar` honored ahead of the active backend per `ix://agent-ix/ix-cli-core/FR-005`.
- **FR-020-AC-7**: `auth.expiresAt` is the only key in the `core` schema not bound to an env var; setting `IX_AUTH_EXPIRES_AT` (if mistakenly used) has no effect on resolution and emits no error (it is simply not part of the schema's env-binding map).

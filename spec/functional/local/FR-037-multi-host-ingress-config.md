---
id: FR-037
title: "Multi-Host Ingress Config — domain.hosts + extraBaseDomains Fanout"
artifact_type: FR
object: configuration
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-007"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-010"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-004"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-008"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

### Schema (persistent, `local` plugin)

The `local` plugin's `LocalConfigSchema` (registered via the plugin
schema contract `ix://agent-ix/ix-cli-core/FR-004`) carries a `domain`
group:

```typescript
domain: {
  hosts: string[];          // length >= 1; default ["dev.ix"]; each entry must
                            // have >= 2 non-empty dot-separated labels and no whitespace
  enableExternal: boolean;  // default false
  external: string | null;  // default null
  publicBaseUrl: string | null; // default null; must start with http:// or https://
}
```

Persisted at `~/.config/ix/config.d/local.yaml`. `ix config get/set
local domain.<key>` operates through the standard `config` command
surface (`ix://agent-ix/ix-cli-core/FR-008`).

### IxConfig contract

`loadConfig()` returns `IxConfig.hosts: string[]` (the full list) and
`IxConfig.internalBaseDomain: string` (an alias for `hosts[0]`). The
alias keeps single-host call sites — admin email construction, login
URL banners, dnsmasq hint output — source-compatible without
multi-host awareness.

### Env var precedence (highest first)

1. `IX_INTERNAL_BASE_DOMAIN` (singular, legacy back-compat) — when set
   and non-empty, overrides `hosts` to a one-entry list `[value]`.
2. `IX_INTERNAL_BASE_DOMAINS` (plural, comma-separated) — when set and
   parses to a non-empty list, overrides `hosts`.
3. The persisted `domain.hosts` from `~/.config/ix/config.d/local.yaml`.
4. Schema default `["dev.ix"]`.

The legacy singular env var takes priority over the plural one to
preserve existing CI invocations that pin `IX_INTERNAL_BASE_DOMAIN=ci.ix`.

### Helm value plumbing (`buildGlobalSetArgs`)

For every Helm install path, the loader emits:

- `--set-string global.internalBaseDomain=<hosts[0]>` — unchanged
  contract for charts that only know the singular value.
- `--set-string global.extraBaseDomains[i]=<hosts[i]>` for `i ∈ [1,N)`
  — empty when the list has one entry.

The shared `ix-service` chart MUST expose
`ingress.exposeExtraHosts: false` as a per-service default. When `true`,
the chart fans out one ingress host per `(fullname, baseDomain)` pair
across both the primary ingress block and the apiGateway block. When
`false`, only the canonical primary host is rendered.

### Wildcard TLS

`init-cluster` issues both the namespace-default wildcard cert and the
ingress-nginx default-SSL cert with one `*.<host>` SAN per entry in
`config.hosts`.

### Wildcard TLS — refresh after `domain.hosts` changes

The cert manifests above are issued at `init-cluster` time. Because
`domain.hosts` can be edited later (`ix config set local domain.hosts
...`), the existing cert's SAN list can drift from the configured
hosts. Two refresh paths are exposed:

1. **Auto-check on `ix up`** — every `runUp` invocation (image and
   source modes) reads the `ix-tls` Secret in `ingress-nginx`, decodes
   the certificate, and compares its DNS SANs against `config.hosts`.
   If the Secret is missing or any configured `*.<host>` is absent
   from the SAN set, both Certificate manifests are re-applied and
   re-issued before the per-app installs proceed. The check is silent
   on the happy path; it renders a single `Listing` line when a
   refresh is performed or when the check itself fails (the failure
   does NOT abort the up flow).

2. **Manual `ix cluster refresh-cert`** — unconditional re-issue of
   both Certificate manifests using the currently-configured hosts.
   Supports `--if-needed` to fall back to the auto-check semantics
   when scripted. Renders a `Listing` reporting the new SAN set.

The ingress-nginx deployment patches (`--default-ssl-certificate`
arg, configmap tweaks) are NOT re-applied in either refresh path —
those are init-time concerns that do not change when hosts do.

### dnsmasq hint output

The post-`init-cluster` operator hint emits one
`address=/.<host>/<clusterIp>` directive per entry in `config.hosts`,
joined into a single line.

## Configuration

| Name | Scope | Type | Default | Description |
|---|---|---|---|---|
| `domain.hosts` | runtime | string[] (length >= 1) | `["dev.ix"]` | Ingress base domains; each entry must have >= 2 non-empty dot-separated labels and no whitespace. `hosts[0]` is aliased as `IxConfig.internalBaseDomain`. Edits trigger the wildcard-TLS refresh paths. |
| `domain.enableExternal` | runtime | boolean | `false` | Enables the external host; setting it without `domain.external` fails loudly at `loadConfig()` time (FR-037-CON-3). |
| `domain.external` | runtime | string or null | `null` | External base domain. |
| `domain.publicBaseUrl` | runtime | string or null | `null` | Canonical public URL for user-facing emails; must start with `http://` or `https://`; single-valued by design and NOT derived from `hosts[0]`. |
| `IX_INTERNAL_BASE_DOMAIN` | session | string (env var) | (unset) | Legacy singular override; when set and non-empty, replaces `hosts` with a one-entry list. Highest precedence. |
| `IX_INTERNAL_BASE_DOMAINS` | session | string (env var, comma-separated) | (unset) | Plural override of `hosts`; below the legacy singular env var, above the persisted file. |
| `ingress.exposeExtraHosts` | creation | boolean (chart value) | `false` | Per-service `ix-service` chart default; when `true`, fans out one ingress host per `(fullname, baseDomain)` pair. Deliberate security boundary (see Security). |

## Acceptance

- **FR-037-AC-1**: A missing `domain` group in the persisted YAML
  yields `hosts: ["dev.ix"]` plus the documented defaults for the
  other fields without error (`ix://agent-ix/ix-cli-core/FR-002`-AC-1 pattern).
- **FR-037-AC-2**: A YAML `domain.hosts: [dev.ix, luna.ix, agent-ix.dev]`
  round-trips through `loadConfig()` as a three-entry list with
  `internalBaseDomain == "dev.ix"`.
- **FR-037-AC-3**: `IX_INTERNAL_BASE_DOMAINS="luna.ix, agent-ix.dev"`
  with no singular env var present overrides the persisted list.
- **FR-037-AC-4**: `IX_INTERNAL_BASE_DOMAIN=ci.ix` set alongside the
  plural env var overrides both file and plural env to
  `hosts: ["ci.ix"]`.
- **FR-037-AC-5**: A persisted entry that fails the base-domain rule
  (single label, contains whitespace) causes `loadConfig()` to throw
  `ConfigValidationError` naming the offending entry. `ix config set
  local domain.hosts '["ix"]'` is rejected at write time by the
  schema.
- **FR-037-AC-6**: `buildGlobalSetArgs` with `hosts: ["dev.ix"]` emits
  `global.internalBaseDomain=dev.ix` and no `extraBaseDomains` flag.
  With `hosts: ["dev.ix","luna.ix","agent-ix.dev"]` it additionally
  emits `global.extraBaseDomains[0]=luna.ix` and
  `global.extraBaseDomains[1]=agent-ix.dev`.
- **FR-037-AC-7**: For a service chart with default
  `ingress.exposeExtraHosts: false`, `helm template` against a
  multi-host config renders a single `host:` entry (the canonical
  primary). With `exposeExtraHosts: true`, it renders one `host:`
  entry per `(fullname, baseDomain)` pair plus per-service literal
  `ingress.extraHosts`.
- **FR-037-AC-8**: The wildcard TLS cert created by `init-cluster`
  contains one `*.<host>` SAN per entry in `config.hosts`.
- **FR-037-AC-9**: With the `ix-tls` Secret present and its SANs
  covering every configured `*.<host>`, `runUp` does not re-apply
  either Certificate and emits no cert-related output.
- **FR-037-AC-10**: With the `ix-tls` Secret missing, or with at
  least one `*.<host>` absent from its SAN set, `runUp` re-applies
  both Certificate manifests, waits for them to become Ready, and
  renders a `Listing` reporting the action before proceeding to the
  per-app installs. A failure inside the cert check renders a
  `failed` `Listing` and continues; it does NOT abort the up flow.
- **FR-037-AC-11**: `ix local cluster refresh-cert` (no flags)
  unconditionally re-applies both Certificate manifests using the
  current `config.hosts`, waits for them to become Ready, and renders
  a `Listing` whose body lists the new DNS SAN set.
- **FR-037-AC-12**: `ix local cluster refresh-cert --if-needed`
  follows the same logic as the `runUp` auto-check (no-op when the
  cert already covers; refresh otherwise).

## Constraints

- **FR-037-CON-1**: `publicBaseUrl` is single-valued by design — it
  appears in user-facing emails (invites, password reset) where one
  canonical URL is required. It is independent of `hosts` and is NOT
  derived from `hosts[0]`.
- **FR-037-CON-2**: `IxConfig.internalBaseDomain` MUST always equal
  `hosts[0]`. Code that needs the canonical host MUST read this alias
  rather than picking out `hosts[0]` directly, so future renames can
  happen in one place.
- **FR-037-CON-3**: `enableExternalHost && !externalBaseDomain` MUST
  fail loudly at `loadConfig()` time. This cross-field rule is
  enforced in `loadConfig` (not in the Zod schema) because Zod
  sibling-field validation is awkward for the shape involved.

## Security

The `ingress.exposeExtraHosts: false` chart default is a deliberate
security boundary, not just an ergonomic switch. Backend services
that do not opt in MUST NOT have ingress hosts emitted under any
entry beyond the canonical primary suffix. This means a backend
addressable as `identity.dev.ix` from inside the cluster's DNS view
remains UNREACHABLE under the public suffix `identity.agent-ix.dev`,
even when `agent-ix.dev` is a configured entry in `domain.hosts`.

External traffic for backend services MUST instead be funneled
through an opted-in gateway service's `apiGateway.routes` (e.g.
`cloud-manager-ui.agent-ix.dev/g/identity/...`). Operators who flip
`exposeExtraHosts: true` on a chart are accepting that the service's
backing pod becomes directly reachable on every external suffix.

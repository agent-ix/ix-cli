---
id: FR-038
title: "Cloudflare Tunnel Exposure — shared cloudflared + per-app expose/unexpose"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-007"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-010"
    type: "extends"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/usecase/US-011"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-037"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-004"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

External app exposure rides on a shared `cloudflared` Deployment that
terminates a wildcard hostname (default `*.agent-ix.dev`) and forwards
every request to `ingress-nginx` with the original `Host` header
preserved. Per-app hostnames are emitted by toggling
`ingress.exposeOnTunnel: true` on the entry-point service and listing
the tunnel base domain in `global.tunnelBaseDomains` (ix-service ≥
v0.11.0).

Tunnel scope is **independent** of [FR-037](./FR-037-multi-host-ingress-config.md) LAN extras: `extraBaseDomains`
/ `exposeExtraHosts` cover LAN-friendly multi-host fan-out (e.g.
`luna.ix`), and `tunnelBaseDomains` / `exposeOnTunnel` cover public
internet exposure. A service can opt into either, both, or neither. The
two never feed each other — adding `agent-ix.dev` to a release does
NOT make any LAN-exposed backend public unless that service also flips
`exposeOnTunnel`.

### Schema (persistent, `local` plugin)

`LocalConfigSchema` carries a `tunnel` group:

```typescript
tunnel: {
  autoStart: boolean; // default false
  baseDomain: string; // default "agent-ix.dev"; same rules as domain.hosts entries
  tunnelId: string | null; // informational only — not used by install
  exposed: Record<string, { hostname: string | null }>; // per-app intent
}
```

`tunnel.exposed` is operator intent: each map key is a release name
(equal to the umbrella name in image mode, or the entry-service name
in source mode) that should be tunnel-routed. `hostname: null` means
"derive `<release>.<baseDomain>`"; a string overrides with an explicit
FQDN. The map is mutated by `ix tunnel expose` / `unexpose` and is the
source of truth — the helm release values are the *effect*, not the
intent. Every `ix up` install pass reads this map and emits the
matching `--set-string` flags so tunnel exposure survives `ix down`
+ `ix up`. `ix tunnel up` walks the map after cloudflared is healthy
and re-applies any drifted overlays.

Persisted at `~/.config/ix/config.d/local.yaml`. `ix config get/set
local tunnel.<key>` operates through the standard `config` command
surface ([FR-008](./FR-008-ix-core-tag-convention.md)). The
Cloudflare tunnel **token** is a separate secret declared in
`LocalSecretsSchema` (`local.cloudflare-tunnel-token`, env binding
`IX_CF_TUNNEL_TOKEN`) — never persisted in plain YAML.

### Helm chart: `cloudflared`

A standalone chart at `helm-charts/charts/cloudflared/` with OCI
annotations `org.agent-ix.deployable=service`,
`org.agent-ix.namespace=platform` (peer to postgres / npm-proxy / other
shared infra in the four-tier namespace contract). One Deployment, one ConfigMap
(catch-all ingress rule pointing at
`ingress-nginx-controller.ingress-nginx.svc:443` with
`originRequest.noTLSVerify: true` and `httpHostHeader: ""` so the
incoming Host is preserved), one Secret holding `TUNNEL_TOKEN`. The
chart's `tunnelToken` value is required and is passed via
`--set-string` from the CLI; helm `tpl fail`s if it's missing.

### CLI surface

All under the `ix tunnel` topic in `apps/ix`:

| Command                    | Behavior                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `ix tunnel up`             | First-run setup on a TTY: prompts for token + base domain. Then `helm upgrade --install cloudflared` in `platform` ns, `--wait`. Off a TTY: fail loud with recovery hint. |
| `ix tunnel down`           | `helm uninstall cloudflared`. Idempotent on missing release.                                        |
| `ix tunnel status`         | Pod phase + currently exposed hosts (any Ingress rule whose host ends in `.<tunnel.baseDomain>`).   |
| `ix tunnel domain [value]` | Read or set `tunnel.baseDomain`. Convenience wrapper around the config write.                       |
| `ix tunnel expose <app>`   | Records intent in `tunnel.exposed[<app>]`; `helm upgrade --reuse-values` on the release with the tunnel overlay (`global.tunnelBaseDomains` + `<entry>.ix-service.ingress.exposeOnTunnel: true`). |
| `ix tunnel unexpose <app>` | Removes the entry from `tunnel.exposed`; `helm upgrade --reuse-values` clears the tunnel keys. LAN keys are not touched. |
| `ix up <app> --expose`     | Convenience: invokes `expose` after a successful image-mode `up`. Skips `"all"` and source mode.    |

After cloudflared comes up (whether via `ix tunnel up` or the
auto-start hook), the runner reconciles every entry in
`tunnel.exposed`: each release that exists gets its overlay
reapplied (idempotent under `--reuse-values`); releases that don't
exist yet are reported as `skipped — no release yet` and don't fail
the reconcile.

The oclif topic `"tunnel"` is registered in `apps/ix/package.json`
under `oclif.topics`. Each command above MUST be registered as a build
entry in `apps/ix/vite.config.ts` so it is emitted under
`dist/commands/tunnel/*`.

`expose` accepts `--hostname=<fqdn>` to override the auto-derived
`<app>.<baseDomain>`. The override is appended to
`<entry>.ix-service.ingress.extraHosts[0]` (single-service:
`ix-service.ingress.extraHosts[0]`) and never to LAN extras.

### Token + base-domain resolution

Three resolution helpers, three policies:

`resolveCloudflareToken()` — pure lookup, never prompts:

1. `IX_CF_TUNNEL_TOKEN` env var (canonical binding).
2. SecretsService backend (`local.cloudflare-tunnel-token`).
3. `null`.

`requireCloudflareToken()` — same lookup, throws on miss. Used by
auto-start (silent skip on null) and by tests.

`firstRunSetup()` — TTY-gated first-run helper used **only** by
`ix tunnel up`. Prompts for the token AND the base domain, persists
both, returns `{ token, baseDomain }`. Off a TTY (CI, headless) it
throws the same actionable error as `requireCloudflareToken`. The
contract:

- Token in env or backend AND `tunnel.baseDomain` set → no prompt,
  no writes (idempotent).
- Token missing, TTY available → `PasswordPrompt` for token, then
  `TextPrompt` for base domain (default = current schema default).
  Token persists to SecretsService; base domain persists to
  `~/.config/ix/config.d/local.yaml` via `ConfigService.set`.
- Token missing, no TTY → throw `TunnelCredentialsError` whose
  message names `IX_CF_TUNNEL_TOKEN`, `ix secrets set
  cloudflare-tunnel-token`, and notes the no-TTY refusal. CI never
  blocks on stdin.
- Token present, base domain at schema default, TTY available →
  prompt for base domain only.

This is the only command path that prompts. `ix cluster start`
auto-start, `ix tunnel expose`/`unexpose`, and `ix up --expose` all
use the silent `resolveCloudflareToken` path.

### Convenience: `ix tunnel domain`

`ix tunnel domain` reads `tunnel.baseDomain`. `ix tunnel domain
<value>` validates and writes via `setTunnelBaseDomain`, the same
helper `firstRunSetup` uses on its second prompt. Reasoning: the
hostname must match a `*.<value>` CNAME the operator created in
Cloudflare DNS, so a typo shouldn't require digging through
`ix config set local tunnel.baseDomain=...` syntax — a dedicated
verb is friendlier and validates with `isValidBaseDomain`.

### Cluster-start auto-start hook ([FR-036](./FR-036-cluster-stop-start.md) extension)

`runClusterStart` runs an additional step after the API server becomes
reachable: if `tunnel.autoStart === true`, it calls `runTunnelUp(config,
{ requireToken: false })`. Two no-op branches preserve invariants:

- Token absent → render a `warn`-tail Listing (`Skipped: no Cloudflare
token`) and return success. Cluster start is not aborted.
- `tunnel.autoStart === false` → no Listing, no helm call, no kubectl
  call. The base flow is byte-for-byte identical to today's behavior.

Tunnel auto-start failures do NOT abort cluster bringup — they are
emitted as a `warn` Listing and swallowed. Per project memory: a
broken Cloudflare account or revoked token must never break `ix
cluster start`. Auto-start also MUST NOT open any interactive credential
prompt, including the GHCR chart-pull prompt; if a non-interactive GHCR
token cannot be resolved, the hook skips with a warn-tail Listing.

### Expose semantics (umbrella vs. service)

Every service-wrapper chart at this org composes ix-service as a
named subchart, so the toggle path is one level deeper than the
wrapper. Apps published as umbrella charts (role=app, with the
`org.agent-ix.entry` annotation pointing at the user-facing
subchart) flip `<entry>.ix-service.ingress.exposeOnTunnel: true` on
**only** the entry subchart's ix-service values. Single-service
releases (role=service) flip `ix-service.ingress.exposeOnTunnel:
true`. The wrapper-chart bare `ingress.<key>` path is never written
— writing there silently no-ops because ix-service doesn't read
wrapper values, and a silent no-op for a security gate is worse
than not having the flag.

Required by the [FR-037](./FR-037-multi-host-ingress-config.md) security boundary: backends that did not opt
in must remain unreachable on the public suffix even when the
suffix is in `global.tunnelBaseDomains`.

Implementation reads the current values via
`helm get values <release> -o json --all`, computes a YAML overlay,
writes it to a temp file, and runs `helm upgrade --reuse-values -f
<file>`. Sibling subcharts are absent from the overlay so
`--reuse-values` keeps their existing values intact. The overlay
merge is implemented as pure functions
(`buildExposeOverlay`, `buildUnexposeOverlay`) so it is unit-testable
without helm or kubectl.

### One-time operator setup (out of scope of CLI)

1. Create tunnel in Cloudflare dashboard → save tunnel ID + token.
2. Add wildcard DNS: `*.<baseDomain>` CNAME →
   `<tunnel-id>.cfargotunnel.com` (proxied).
3. `ix secrets set cloudflare-tunnel-token` (or export
   `IX_CF_TUNNEL_TOKEN`).
4. Optional: `ix config set local tunnel.tunnelId=<id>`,
   `ix config set local tunnel.autoStart=true`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-038-AC-1 | A missing `tunnel` group in the persisted YAML yields `{ autoStart: false, baseDomain: "agent-ix.dev", tunnelId: null }` without error ([FR-002](./FR-002-phase-table-integration.md)-AC-1 pattern). | Test |
| FR-038-AC-2 | A YAML `tunnel: { autoStart: true, baseDomain: foo.example.com, tunnelId: abc-123 }` round-trips through `loadTunnelConfig()` unchanged. | Test |
| FR-038-AC-3 | `tunnel.autoStart` accepts string `"true"`/`"false"` and coerces to boolean (Zod `coerce`). | Test |
| FR-038-AC-4 | A persisted `tunnel.baseDomain` that fails the base-domain rule (single label, whitespace) does NOT throw at load time — `ConfigService` substitutes the schema default and records the incident (visible via `ix config doctor`). | Test |
| FR-038-AC-5 | `resolveCloudflareToken()` returns the value of `IX_CF_TUNNEL_TOKEN` when set, even if a different value is stored in the SecretsService backend. | Test |
| FR-038-AC-6 | With `IX_CF_TUNNEL_TOKEN` unset and a value stored in the SecretsService backend, `resolveCloudflareToken()` returns the stored value. | Test |
| FR-038-AC-7 | With neither env nor backend set, `resolveCloudflareToken()` returns `null` and `requireCloudflareToken()` throws a `TunnelCredentialsError` whose message names the env var. | Test |
| FR-038-AC-8 | `buildExposeOverlay({}, "agent-ix.dev", null, null)` writes `global.tunnelBaseDomains: ["agent-ix.dev"]` and `ix-service.ingress.exposeOnTunnel: true`. The toggle MUST land on the `ix-service.ingress` path because every service-wrapper chart at this org composes ix-service as a named subchart — writing at the wrapper-chart's bare `ingress.<key>` would silently no-op, which for a security gate is worse than not having the flag at all. The overlay never writes `extraBaseDomains` or `exposeExtraHosts` — those are the LAN scope and remain operator-managed. | Test |
| FR-038-AC-9 | `buildExposeOverlay` is idempotent — re-exposing a release whose `global.tunnelBaseDomains` already contains the base domain does not duplicate it. | Test |
| FR-038-AC-10 | When given an `entryKey`, `buildExposeOverlay` routes the ingress flip through `<entryKey>.ix-service.ingress` (the actual ix-service subchart values inside the wrapper). The overlay MUST NOT contain entries for sibling subcharts so `helm upgrade --reuse-values -f <file>` keeps their values intact. Other keys inside the same `<entryKey>.ix-service` block (e.g. `fullnameOverride`) round-trip unchanged. | Test |
| FR-038-AC-11 | `buildUnexposeOverlay` removes the base domain from `global.tunnelBaseDomains`, sets `ingress.exposeOnTunnel: false`, and strips any `ingress.extraHosts` entries that end with `.<baseDomain>` (operator-supplied hosts under other suffixes are preserved). LAN keys (`extraBaseDomains`, `exposeExtraHosts`) are not touched. | Test |
| FR-038-AC-12 | `helm template charts/cloudflared --set tunnelToken=...` renders a Deployment, ConfigMap, and Secret. With `tunnelToken` empty/missing, the template fails with the exact error `cloudflared: .Values.tunnelToken is required (pass via '--set-string tunnelToken=…')`. | Test |
| FR-038-AC-13 | With `tunnel.autoStart=false` and the cluster reachable, `runClusterStart` produces no cloudflared install call and no tunnel-related Listing. | Test |
| FR-038-AC-14 | With `tunnel.autoStart=true` and a resolvable token, `runClusterStart` invokes `runTunnelUp(config)` after the API server is reachable and renders a `passed` tunnel Listing. | Test |
| FR-038-AC-15 | With `tunnel.autoStart=true` and no resolvable token, `runClusterStart` renders a `warn`-tail tunnel Listing (`Skipped: no Cloudflare token`) and returns success. | Test |
| FR-038-AC-16 | Failures inside the tunnel auto-start hook (`runTunnelUp` throws) MUST NOT propagate out of `runClusterStart`. The cluster start exit code is unchanged, and a `warn`-tail Listing surfaces the failure message. | Test |
| FR-038-AC-17 | `ix tunnel expose <app>` with a missing helm release fails with the message `No helm release named '<app>' in namespace '<ns>'. Run \`ix up <app>\` first.` | Test |
| FR-038-AC-20 | `firstRunSetup({ isTTY: false })` with no resolvable token throws `TunnelCredentialsError` whose message contains `no TTY — refusing to prompt`. CI never hangs on stdin. | Test |
| FR-038-AC-21 | `firstRunSetup({ isTTY: false })` with a token already set returns `{ token, baseDomain }` without prompting and without writing to disk. | Test |
| FR-038-AC-22 | `firstRunSetup({ isTTY: true })` with no token invokes the password prompt then the base-domain prompt; on success, persists token to SecretsService and base domain to `~/.config/ix/config.d/local.yaml`. | Test |
| FR-038-AC-23 | `firstRunSetup` is idempotent — when both token and a non-default `tunnel.baseDomain` are already configured, it returns them without prompting and without writing. | Test |
| FR-038-AC-24 | `setTunnelBaseDomain(value)` rejects values that fail `isValidBaseDomain` with `TunnelCredentialsError` and does NOT write to disk. | Test |
| FR-038-AC-25 | `ix tunnel domain` (no arg) prints the current `tunnel.baseDomain`. `ix tunnel domain <value>` validates, persists, and reports the new value plus a reminder to verify the matching `*.<value>` CNAME in Cloudflare DNS. | Test |
| FR-038-AC-18 | `ix tunnel down` with no installed release exits zero (idempotent). | Test |
| FR-038-AC-19 | Every `apps/ix/src/commands/tunnel/*.ts` command has a matching `apps/ix/vite.config.ts` build entry and is emitted under `dist/commands/tunnel/*`. | Test |
| FR-038-AC-26 | `buildTunnelSetArgs(tunnel, release, null)` returns `[]` when `tunnel.exposed[release]` is absent (so install paths can append the result unconditionally without leaking tunnel keys onto releases that have no expose intent). | Test |
| FR-038-AC-27 | `buildTunnelSetArgs(tunnel, release, null)` for an exposed single-service release emits `global.tunnelBaseDomains[0]=<base>` and `ix-service.ingress.exposeOnTunnel=true`. With a non-null `entryKey`, the toggle is `<entryKey>.ix-service.ingress.exposeOnTunnel=true` and the wrapper-level/top-level forms are NOT set — non-entry subcharts must never inherit exposure, and a wrapper-level toggle would silently no-op (the value isn't read by ix-service). | Test |
| FR-038-AC-28 | `buildTunnelSetArgs` with a non-null `tunnel.exposed[release].hostname` appends `<entryKey>.ix-service.ingress.extraHosts[0]=<override>` (or `ix-service.ingress.extraHosts[0]=<override>` for single-service releases). Same `ix-service.` prefix rationale as AC-8. | Test |
| FR-038-AC-29 | `runTunnelExposeCommand` persists the release's intent into `tunnel.exposed` after the helm upgrade succeeds. `runTunnelUnexposeCommand` removes the entry. Subsequent `loadTunnelConfig()` reads reflect the change. | Test |
| FR-038-AC-30 | After cloudflared install succeeds, `runTunnelUpCommand` reconciles every entry in `tunnel.exposed` by calling `exposeApp` (idempotent). Releases that don't exist yet produce a `skipped` row and do not fail the reconcile; helm errors produce a `failed` row and the command exits non-zero. | Test |

- **FR-038-AC-1**: A missing `tunnel` group in the persisted YAML
  yields `{ autoStart: false, baseDomain: "agent-ix.dev", tunnelId:
null }` without error (`ix://agent-ix/ix-cli-core/[FR-002](./FR-002-phase-table-integration.md)`-AC-1 pattern).
- **FR-038-AC-2**: A YAML `tunnel: { autoStart: true, baseDomain:
foo.example.com, tunnelId: abc-123 }` round-trips through
  `loadTunnelConfig()` unchanged.
- **FR-038-AC-3**: `tunnel.autoStart` accepts string `"true"`/`"false"`
  and coerces to boolean (Zod `coerce`).
- **FR-038-AC-4**: A persisted `tunnel.baseDomain` that fails the
  base-domain rule (single label, whitespace) does NOT throw at load
  time — `ConfigService` substitutes the schema default and records
  the incident (visible via `ix config doctor`).
- **FR-038-AC-5**: `resolveCloudflareToken()` returns the value of
  `IX_CF_TUNNEL_TOKEN` when set, even if a different value is stored
  in the SecretsService backend.
- **FR-038-AC-6**: With `IX_CF_TUNNEL_TOKEN` unset and a value stored
  in the SecretsService backend, `resolveCloudflareToken()` returns
  the stored value.
- **FR-038-AC-7**: With neither env nor backend set,
  `resolveCloudflareToken()` returns `null` and
  `requireCloudflareToken()` throws a `TunnelCredentialsError` whose
  message names the env var.
- **FR-038-AC-8**: `buildExposeOverlay({}, "agent-ix.dev", null,
null)` writes `global.tunnelBaseDomains: ["agent-ix.dev"]` and
  `ix-service.ingress.exposeOnTunnel: true`. The toggle MUST land on
  the `ix-service.ingress` path because every service-wrapper chart
  at this org composes ix-service as a named subchart — writing at
  the wrapper-chart's bare `ingress.<key>` would silently no-op,
  which for a security gate is worse than not having the flag at
  all. The overlay never writes `extraBaseDomains` or
  `exposeExtraHosts` — those are the LAN scope and remain
  operator-managed.
- **FR-038-AC-9**: `buildExposeOverlay` is idempotent — re-exposing a
  release whose `global.tunnelBaseDomains` already contains the base
  domain does not duplicate it.
- **FR-038-AC-10**: When given an `entryKey`, `buildExposeOverlay`
  routes the ingress flip through `<entryKey>.ix-service.ingress`
  (the actual ix-service subchart values inside the wrapper). The
  overlay MUST NOT contain entries for sibling subcharts so
  `helm upgrade --reuse-values -f <file>` keeps their values intact.
  Other keys inside the same `<entryKey>.ix-service` block (e.g.
  `fullnameOverride`) round-trip unchanged.
- **FR-038-AC-11**: `buildUnexposeOverlay` removes the base domain
  from `global.tunnelBaseDomains`, sets `ingress.exposeOnTunnel:
false`, and strips any `ingress.extraHosts` entries that end with
  `.<baseDomain>` (operator-supplied hosts under other suffixes are
  preserved). LAN keys (`extraBaseDomains`, `exposeExtraHosts`) are
  not touched.
- **FR-038-AC-12**: `helm template charts/cloudflared --set
tunnelToken=...` renders a Deployment, ConfigMap, and Secret. With
  `tunnelToken` empty/missing, the template fails with the exact
  error `cloudflared: .Values.tunnelToken is required (pass via
'--set-string tunnelToken=…')`.
- **FR-038-AC-13**: With `tunnel.autoStart=false` and the cluster
  reachable, `runClusterStart` produces no cloudflared install call
  and no tunnel-related Listing.
- **FR-038-AC-14**: With `tunnel.autoStart=true` and a resolvable
  token, `runClusterStart` invokes `runTunnelUp(config)` after the
  API server is reachable and renders a `passed` tunnel Listing.
- **FR-038-AC-15**: With `tunnel.autoStart=true` and no resolvable
  token, `runClusterStart` renders a `warn`-tail tunnel Listing
  (`Skipped: no Cloudflare token`) and returns success.
- **FR-038-AC-16**: Failures inside the tunnel auto-start hook
  (`runTunnelUp` throws) MUST NOT propagate out of `runClusterStart`.
  The cluster start exit code is unchanged, and a `warn`-tail
  Listing surfaces the failure message.
- **FR-038-AC-17**: `ix tunnel expose <app>` with a missing helm
  release fails with the message `No helm release named '<app>' in
namespace '<ns>'. Run \`ix up <app>\` first.`
- **FR-038-AC-20**: `firstRunSetup({ isTTY: false })` with no
  resolvable token throws `TunnelCredentialsError` whose message
  contains `no TTY — refusing to prompt`. CI never hangs on stdin.
- **FR-038-AC-21**: `firstRunSetup({ isTTY: false })` with a token
  already set returns `{ token, baseDomain }` without prompting and
  without writing to disk.
- **FR-038-AC-22**: `firstRunSetup({ isTTY: true })` with no token
  invokes the password prompt then the base-domain prompt; on
  success, persists token to SecretsService and base domain to
  `~/.config/ix/config.d/local.yaml`.
- **FR-038-AC-23**: `firstRunSetup` is idempotent — when both token
  and a non-default `tunnel.baseDomain` are already configured, it
  returns them without prompting and without writing.
- **FR-038-AC-24**: `setTunnelBaseDomain(value)` rejects values that
  fail `isValidBaseDomain` with `TunnelCredentialsError` and does
  NOT write to disk.
- **FR-038-AC-25**: `ix tunnel domain` (no arg) prints the current
  `tunnel.baseDomain`. `ix tunnel domain <value>` validates,
  persists, and reports the new value plus a reminder to verify the
  matching `*.<value>` CNAME in Cloudflare DNS.
- **FR-038-AC-18**: `ix tunnel down` with no installed release exits
  zero (idempotent).
- **FR-038-AC-19**: Every `apps/ix/src/commands/tunnel/*.ts` command has
  a matching `apps/ix/vite.config.ts` build entry and is emitted under
  `dist/commands/tunnel/*`.
- **FR-038-AC-26**: `buildTunnelSetArgs(tunnel, release, null)` returns
  `[]` when `tunnel.exposed[release]` is absent (so install paths can
  append the result unconditionally without leaking tunnel keys onto
  releases that have no expose intent).
- **FR-038-AC-27**: `buildTunnelSetArgs(tunnel, release, null)` for an
  exposed single-service release emits
  `global.tunnelBaseDomains[0]=<base>` and
  `ix-service.ingress.exposeOnTunnel=true`. With a non-null
  `entryKey`, the toggle is `<entryKey>.ix-service.ingress.exposeOnTunnel=true`
  and the wrapper-level/top-level forms are NOT set — non-entry
  subcharts must never inherit exposure, and a wrapper-level toggle
  would silently no-op (the value isn't read by ix-service).
- **FR-038-AC-28**: `buildTunnelSetArgs` with a non-null
  `tunnel.exposed[release].hostname` appends
  `<entryKey>.ix-service.ingress.extraHosts[0]=<override>` (or
  `ix-service.ingress.extraHosts[0]=<override>` for single-service
  releases). Same `ix-service.` prefix rationale as AC-8.
- **FR-038-AC-29**: `runTunnelExposeCommand` persists the release's
  intent into `tunnel.exposed` after the helm upgrade succeeds.
  `runTunnelUnexposeCommand` removes the entry. Subsequent
  `loadTunnelConfig()` reads reflect the change.
- **FR-038-AC-30**: After cloudflared install succeeds,
  `runTunnelUpCommand` reconciles every entry in `tunnel.exposed` by
  calling `exposeApp` (idempotent). Releases that don't exist yet
  produce a `skipped` row and do not fail the reconcile; helm errors
  produce a `failed` row and the command exits non-zero.

## Constraints

- **FR-038-CON-1**: The cloudflared chart is opt-in — `make up` /
  `ix cluster start` MUST NOT install it unless `tunnel.autoStart`
  is true. This preserves the project invariant that a cluster
  without Cloudflare creds boots and stays usable.
- **FR-038-CON-2**: For umbrella apps, `ingress.exposeOnTunnel` MUST
  be flipped on the entry subchart's values only, never via
  `global.*`. Routing the toggle through globals would breach the
  [FR-037](./FR-037-multi-host-ingress-config.md) security boundary by exposing every backend on the public
  suffix.
- **FR-038-CON-5**: Tunnel and LAN scopes are independent. The CLI
  install paths (`buildGlobalSetArgs`, `buildTunnelSetArgs`) and the
  expose overlays MUST NOT cross-pollinate the two key sets:
  `extraBaseDomains` / `exposeExtraHosts` are LAN-only, and
  `tunnelBaseDomains` / `exposeOnTunnel` are tunnel-only.
- **FR-038-CON-3**: The Cloudflare tunnel token MUST NOT be
  persisted in `~/.config/ix/config.d/local.yaml`. It lives in the
  SecretsService backend ([FR-005](./FR-005-cluster-up.md)) or in `IX_CF_TUNNEL_TOKEN`.
- **FR-038-CON-4**: There is intentionally no interactive prompt for
  credentials during cluster auto-start. Failures during cluster
  bringup must be silent (auto-start) or loud-and-actionable (`ix
tunnel up`), never blocking on user input.

## Security

The `cloudflared` Deployment terminates external traffic. The
cluster-internal hop from cloudflared → ingress-nginx is
in-cluster-only and uses `noTLSVerify: true` because ingress-nginx
serves the local self-signed cert ([FR-037](./FR-037-multi-host-ingress-config.md) — `*.dev.ix` initiative).
Once that initiative lands a true wildcard cert, this flag SHOULD be
removed in a follow-up. The decision is documented inline on the
ConfigMap template.

The [FR-037-CON-3](./FR-037-multi-host-ingress-config.md) boundary continues to hold: backends without
`ingress.exposeOnTunnel: true` remain unreachable from the tunnel
even when cloudflared is up and the base domain is in
`global.tunnelBaseDomains`. External traffic to backend services
MUST still be funneled through an opted-in gateway service's
`apiGateway.routes`.

CORS allow-lists (`ix-service.serviceOrigins`) intentionally do NOT
include tunnel hosts: the `/g/<service>` gateway pattern keeps tunnel
traffic same-origin from the browser, so backends never see a tunnel
`Origin` header. Including tunnel origins in CORS would weaken the
LAN-only allow-list with no compensating benefit.

The tunnel token is a bearer credential giving anyone holding it the
ability to publish traffic on the configured Cloudflare zone.
Resolution avoids logs (no echo, no `--set` plain string at command-line
top-level — passed only via `--set-string tunnelToken=` to helm
which redacts it from rendered manifests in `helm get manifest`).

## Dependencies

- **implements**: ix-cli/spec/stakeholder/[StR-007](../../stakeholder/StR-007-multi-host-ingress-suffixes.md)
- **extends**: ix-cli/spec/usecase/[US-010](../../usecase/US-010-multi-host-ingress.md)
- **implements**: ix-cli/spec/usecase/[US-011](../../usecase/US-011-expose-app-via-cloudflare-tunnel.md)
- **requires**: ix-cli/spec/functional/local/[FR-037](./FR-037-multi-host-ingress-config.md)
- **requires**: ix-cli-core/spec/functional/[FR-004](./FR-004-cluster-subcommand-group.md)
- **requires**: ix-cli-core/spec/functional/[FR-005](./FR-005-cluster-up.md)

---
id: US-011
title: "Operator Exposes a Local App on a Public Hostname via Cloudflare Tunnel"
type: US
relationships:
  - target: "ix://agent-ix/ix-cli/spec/stakeholder/StR-007"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli/spec/functional/local/FR-038"
    type: "implements"
    cardinality: "1:1"
---

## Story

As a **platform engineer** running an app on my local kind cluster
(via `ix up`), I want to share that app with a teammate or stakeholder
on the public internet using a friendly hostname like
`cloud-manager.agent-ix.dev` — without exposing my LAN, without
restarting the cluster, and without per-app DNS or tunnel
configuration. When I'm done demoing I want to take it private again
just as quickly.

## Context

The flow rides on a shared Cloudflare Tunnel: cloudflared runs once
in the cluster, terminates a wildcard hostname (default
`*.agent-ix.dev`), and forwards by `Host` header to ingress-nginx.
Per-app exposure is its own scope, separate from the FR-037 LAN
extras: `global.tunnelBaseDomains` + `ingress.exposeOnTunnel: true`
on the entry subchart's ix-service values renders the public host.
LAN extras (`extraBaseDomains` / `exposeExtraHosts`) stay
operator-managed and untouched by tunnel commands. Apps that aren't
explicitly exposed remain private (FR-037 security boundary).

Operator intent for "this release should be tunnel-routed" lives in
`~/.config/ix/config.d/local.yaml` under `tunnel.exposed[<release>]`
— not on the helm release itself. That makes exposure survive
reinstalls: `ix down <app>` followed by `ix up <app>` reapplies the
tunnel toggle automatically. `ix tunnel up` does the inverse:
after cloudflared is healthy it walks every entry in
`tunnel.exposed` and reconciles any release that's missing the
overlay.

### One-time setup (operator)

The operator does this once per Cloudflare account:

1. Create a tunnel in the Cloudflare dashboard (Zero Trust → Networks
   → Tunnels). Note the tunnel ID + token.
2. Add a wildcard CNAME in the `agent-ix.dev` zone:
   `*.agent-ix.dev → <tunnel-id>.cfargotunnel.com` (proxied).
3. Run `ix tunnel up`. The first run on a TTY prompts for the
   token (stored via SecretsService) and the base domain
   (persisted to `~/.config/ix/config.d/local.yaml`); subsequent
   runs skip the prompt and just reconcile the helm release.

For CI / scripted setup, the same can be done non-interactively:
```bash
export IX_CF_TUNNEL_TOKEN=…           # or: ix secrets set cloudflare-tunnel-token
ix tunnel domain agent-ix.dev          # or: ix config set local tunnel.baseDomain=agent-ix.dev
ix tunnel up
```

### Daily flow (operator)

```bash
ix up cloud-manager                    # local install, *.dev.ix only
ix tunnel expose cloud-manager         # add *.agent-ix.dev to the ingress
# … demo …
ix tunnel unexpose cloud-manager       # back to private
```

Or in a single step:
```bash
ix up cloud-manager --expose
```

`ix tunnel status` lists the tunnel pod state and every host
currently terminated under `*.<tunnel.baseDomain>`. `ix tunnel down`
stops the tunnel entirely (every exposed app goes dark at once).

### Cluster-restart behavior

When the cluster is paused/resumed (`ix cluster stop`/`start`):

- If `tunnel.autoStart=false` (default): cloudflared does not come
  back up; the operator runs `ix tunnel up` when they want it again.
- If `tunnel.autoStart=true`: `ix cluster start` brings cloudflared
  up after the API server is reachable, silently skipping when no
  token is resolvable. Cluster start NEVER blocks on stdin — the
  prompt-on-TTY behavior is scoped to explicit `ix tunnel up`.

Per-app exposure DOES survive `ix down <app>` + `ix up <app>` —
intent is in the CLI config, not on the helm release, so the next
install pass re-emits the tunnel `--set` flags automatically. To
fully remove exposure (both intent and effect), run
`ix tunnel unexpose <app>`.

Likewise after `ix tunnel down` + `ix tunnel up`, the reconcile
phase walks `tunnel.exposed` and reapplies overlays for every
release that has intent. Releases that don't exist yet (operator
recorded intent before installing the app) are reported as
`skipped — no release yet — \`ix up\` will pick up intent`.

## Acceptance

- **US-011-AC-1**: First-run on a TTY: `ix tunnel up` with no token
  configured prompts for the token and the base domain, persists
  both, and brings cloudflared up. The next invocation runs without
  prompting.
- **US-011-AC-2**: Off-TTY (CI): `ix tunnel up` with no token
  configured exits non-zero with an actionable error pointing at
  `IX_CF_TUNNEL_TOKEN` and `ix secrets set cloudflare-tunnel-token`.
  Stdin is never read.
- **US-011-AC-3**: `ix tunnel domain` (no arg) prints the current
  `tunnel.baseDomain`. `ix tunnel domain <fqdn>` validates and
  persists; an invalid value (single label, whitespace) is rejected
  with a clear error and no write occurs.
- **US-011-AC-4**: After `ix up cloud-manager` and
  `ix tunnel expose cloud-manager`, the app's Ingress has rules for
  both `*.dev.ix` and `*.agent-ix.dev` (or whatever
  `tunnel.baseDomain` is set to), and the public URL returns the
  app's response from off-LAN. The release's
  `tunnel.exposed[cloud-manager]` entry is persisted in the CLI
  config.
- **US-011-AC-5**: `ix tunnel unexpose cloud-manager` removes the
  `*.<tunnel.baseDomain>` rule from the Ingress AND removes the
  CLI-config entry. The internal host (e.g.
  `cloud-manager-ui.dev.ix`) keeps working; LAN extras
  (`*.luna.ix`) are not touched.
- **US-011-AC-6**: Exposing one app does NOT expose any other app
  — sibling subcharts in an umbrella release stay private. The
  toggle is written to `<entry>.ix-service.ingress.exposeOnTunnel`,
  never to the wrapper-chart bare path or to non-entry subcharts.
- **US-011-AC-11**: Tunnel exposure survives `ix down <app>` +
  `ix up <app>`. The CLI config holds the intent; the install path
  re-emits `global.tunnelBaseDomains` + the entry-subchart
  `exposeOnTunnel` flag automatically.
- **US-011-AC-12**: `ix tunnel up` after cloudflared becomes ready
  reconciles every `tunnel.exposed` entry. Releases that exist get
  `helm upgrade --reuse-values` with the tunnel overlay (idempotent
  no-op when already correct); releases that don't exist yet are
  reported as `skipped` and do not fail the reconcile.
- **US-011-AC-7**: `ix up cloud-manager --expose` performs the
  install AND the exposure in one step, equivalent to the two-
  command form. Skipped under `--from-source` (source mode is for
  dev loops, not external demos).
- **US-011-AC-8**: `ix tunnel status` reports the cloudflared pod
  phase and lists every host in the cluster whose Ingress rule ends
  with `.<tunnel.baseDomain>`.
- **US-011-AC-9**: With `tunnel.autoStart=true` and a resolvable
  token, `ix cluster start` brings cloudflared up after the API
  server is reachable; cluster start exits zero and never opens an
  interactive prompt. With `autoStart=false`, no tunnel-related
  output is produced.
- **US-011-AC-10**: An expired/revoked Cloudflare token does NOT
  break `ix cluster start` — the auto-start hook surfaces a
  warn-tail Listing and the cluster is reachable as usual.

## Test Coverage

| AC | Verified by |
|---|---|
| US-011-AC-1 | TC-432 (firstRunSetup TTY prompts + persists), TC-433 (idempotent on second invocation). |
| US-011-AC-2 | TC-430 (firstRunSetup non-TTY throws CI-safe error). |
| US-011-AC-3 | TC-434, TC-435 (setTunnelBaseDomain), TC-436 (`ix tunnel domain` runner — read/write/reject). |
| US-011-AC-4 | TC-405–TC-409 (overlay merge + entry-subchart targeting). Live-cluster smoke ❌ Missing. |
| US-011-AC-5 | TC-410–TC-412 (unexpose overlay strips base domain + matching extraHosts). |
| US-011-AC-6 | TC-409, TC-412 (siblings absent from overlay; FR-037-CON-3 boundary preserved). |
| US-011-AC-7 | TC-424 (static: `--from-source --expose` does not run tunnel exposure). |
| US-011-AC-8 | Inherits FR-038-AC-12-style `getTunnelStatus` shape; live-cluster integration ❌ Missing. |
| US-011-AC-9 | TC-417 (autoStart=false skip), TC-418 (autoStart=true success), TC-419 (no-token warn-tail). |
| US-011-AC-10 | TC-420 (auto-start failure swallowed by cluster-start). |
| US-011-AC-11 | TC-041–TC-044 (`buildTunnelSetArgs` emits tunnel flags from `tunnel.exposed` on every install pass). Live-cluster `ix down` + `ix up` smoke ❌ Missing. |
| US-011-AC-12 | TC-401 (tunnel.exposed round-trips through config). Live-cluster `tunnel up` reconcile smoke ❌ Missing. |

# Tunnel — Cloudflare Tunnel exposure for local apps

Expose an app running on your local kind cluster on a public hostname
(e.g. `cloud-manager-ui.agent-ix.dev`) without opening firewall ports
or fronting your LAN. Backed by a single shared `cloudflared`
deployment that terminates `*.<tunnel.baseDomain>` and forwards by
`Host` header to ingress-nginx.

## TL;DR

```bash
ix tunnel up                               # one-time: prompts for token + base domain
ix tunnel expose cloud-manager-app         # public host live; intent persisted
curl https://cloud-manager-ui.agent-ix.dev # HTTP 200 from anywhere
ix tunnel unexpose cloud-manager-app       # back to private; intent cleared
```

## Mental model

Two scopes, independent:

| Scope | Domain example | Configured by | Rendered when |
|---|---|---|---|
| LAN | `*.luna.ix` | `domain.hosts` in `~/.config/ix/config.d/local.yaml` | `ingress.exposeExtraHosts: true` on a service |
| Tunnel | `*.agent-ix.dev` | `tunnel.baseDomain` + per-app `tunnel.exposed[<app>]` | `ingress.exposeOnTunnel: true` on the entry of an exposed release |

The two never cross-pollinate. A backend that's on LAN extras for
testing does NOT become public when you expose its parent app to the
tunnel.

## Commands

| Command | What it does |
|---|---|
| `ix tunnel up` | Install/upgrade `cloudflared`. First run on a TTY prompts for the Cloudflare token and base domain. After install, walks `tunnel.exposed` and reapplies any drifted overlays. |
| `ix tunnel down` | Uninstall `cloudflared`. Does not touch `tunnel.exposed` — bringing the tunnel back up restores routing without re-running expose. |
| `ix tunnel status` | Cloudflared pod phase + every host in the cluster whose Ingress rule ends with `.<tunnel.baseDomain>`. |
| `ix tunnel domain [<fqdn>]` | Read or set `tunnel.baseDomain`. Validates that the value is a real FQDN. |
| `ix tunnel expose <app> [--hostname <fqdn>]` | Records intent in `tunnel.exposed[<app>]` and runs `helm upgrade --reuse-values` to add the public host. Idempotent. With `--hostname`, the explicit FQDN goes into `extraHosts` alongside the auto-derived `<app>.<baseDomain>`. |
| `ix tunnel unexpose <app>` | Removes the entry from `tunnel.exposed` and clears the tunnel keys on the helm release. LAN keys untouched. |
| `ix up <app> --expose` | Convenience: install then expose in one step. Image-mode only. |

## Persistence model — why exposure survives reinstalls

Operator intent (which apps should be tunnel-routed) lives in
`~/.config/ix/config.d/local.yaml`:

```yaml
tunnel:
  baseDomain: agent-ix.dev
  exposed:
    cloud-manager-app:
      hostname: null              # null → derive <release>.<baseDomain>
    spec-editor:
      hostname: spec.example.dev  # explicit override
```

This is the **source of truth**. The helm release values are the
*effect*, not the intent. Every `ix up` install pass reads
`tunnel.exposed` and emits the matching `--set-string` flags. So:

- `ix down cloud-manager-app && ix up cloud-manager-app` → tunnel
  exposure auto-restored, no need to re-run expose.
- `ix tunnel down && ix tunnel up` → after cloudflared is healthy,
  every entry in `tunnel.exposed` is reconciled with verbose
  per-app status rows. Releases that don't exist yet are reported
  as `skipped — no release yet`.
- A truly clean teardown is `ix tunnel unexpose <app>` — it clears
  both the intent and the effect.

## What gets written under the hood

For an exposed release, `ix up` (or `ix tunnel expose`) emits these
helm values:

```yaml
global:
  tunnelBaseDomains: [agent-ix.dev]    # populated only when intent exists

# umbrella release (entry = cloud-manager-ui)
cloud-manager-ui:
  ix-service:
    ingress:
      exposeOnTunnel: true             # toggle ONLY on the entry subchart

# single-service release
ix-service:
  ingress:
    exposeOnTunnel: true               # toggle at the wrapper-chart's ix-service block
```

The chart only renders an Ingress host when **both** the global list
is non-empty AND the per-service `exposeOnTunnel` is true. That's
the per-deploy security gate: chart defaults are `false`, the gate
flips only on releases the operator has explicitly exposed, and only
on their entry subchart.

## Required chart annotations (umbrella authors)

For an umbrella chart, declare which subchart is the entry so
`ix tunnel expose` knows where to flip the toggle:

```yaml
# helm/<umbrella>/Chart.yaml
annotations:
  org.agent-ix.deployable: "app"
  org.agent-ix.entry: "cloud-manager-ui"   # subchart name
```

Without `org.agent-ix.entry`, expose collapses to a wrapper-level
toggle that ix-service doesn't read — the public host won't render
even though the command appears to succeed. Not having the
annotation is a foot-gun the spec calls out (FR-038-AC-10).

## Cluster-restart behavior

| `tunnel.autoStart` | `ix cluster start` does |
|---|---|
| `false` (default) | Nothing — operator runs `ix tunnel up` when wanted. |
| `true` | After API server is reachable, brings cloudflared up if a token is resolvable; silently skips with a warn-tail Listing if not. Cluster start NEVER blocks on stdin and NEVER fails because of tunnel issues. |

The interactive prompt (token, base domain) is scoped to explicit
`ix tunnel up` only. Auto-start is silent.

## Troubleshooting

**`ix tunnel expose` reports success but the public host doesn't load.**
Check that the umbrella's `Chart.yaml` has `org.agent-ix.entry: <subchart>`. Without it the toggle goes to a wrapper path ix-service doesn't read. Then check `helm get values <release> -o json --all` for `<entry>.ix-service.ingress.exposeOnTunnel: true`.

**`helm upgrade --install cloudflared` times out with "context deadline exceeded".**
The cloudflared chart bumps cover this (startupProbe + 10-minute helm timeout). Make sure `TUNNEL_CHART_VERSION` ≥ 0.11.0 in `packages/local/src/tunnel/install.ts`.

**`ix tunnel status` shows zero exposed hosts after `ix down` + `ix up`.**
That's the failure mode the persistence model fixes. Verify
`tunnel.exposed` in your local YAML; if it's populated but the host
isn't, run `ix tunnel up` to trigger reconciliation.

**Public requests get 404 or wrong app.**
Cloudflare-side public-hostname mapping must point at
`https://ingress-nginx-controller.ingress-nginx.svc.cluster.local:443`
(or `:80` http) with `noTLSVerify` on, and the Host header preserved.
Configured once in the Cloudflare dashboard, not by this CLI.

## See also

- Spec: `spec/functional/local/FR-038-cloudflare-tunnel-exposure.md`
- Use case: `spec/usecase/US-011-expose-app-via-cloudflare-tunnel.md`
- Boundary contract: `spec/functional/local/FR-037-multi-host-ingress-config.md`

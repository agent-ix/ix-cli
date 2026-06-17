---
id: REV-001
title: "Runtime Plugin Addendum Review"
type: Review
---

# Runtime Plugin Addendum Review

Date: 2026-05-10

## Result

Status: ready for implementation planning, with tests intentionally marked
pending until runtime code is extracted.

## Findings

1. **Existing config/secrets FRs remain valid.**
   The addendum extends the runtime boundary and does not replace existing
   `ConfigService` or `SecretsService` requirements.

2. **Bootstrap order is load-bearing.**
   `--config-root` and config-root env vars must be parsed before plugin
   manifests are loaded, otherwise custom CLI distributions cannot isolate
   config reliably.

3. **Capability binding should start narrow.**
   Initial implementation should support a small built-in capability set:
   `github`, `ix-api`, and `review-service`. Additional capabilities can be
   added after the plugin contract stabilizes.

4. **The workflow plugin is the first external consumer.**
   `ix-agent-skills` should use these requirements to build
   `workflow-cli-plugin` as the proving integration.


---

## Follow-up review (2026-05-10): retract custom plugin platform

After the runtime-plugin-platform implementation landed (commits `c5ac413`,
`1bbcf9c`) and the workflow plugin was wired in (`eaf1ba6`), a second review
surfaced gaps that pointed at a deeper issue: the platform was duplicating
oclif's native plugin system rather than layering on top of it.

### Specific gaps that triggered the retraction

- [FR-023](../functional/core/FR-023-ix-logout.md) manifest loader's helpers existed in
  `packages/core/src/runtime/manifest.ts` but had zero callers in
  `apps/ix/src/` — the on-disk plugin manifest was never read.
- FR-024 capability resolver in
  `packages/core/src/runtime/capabilities.ts` likewise had zero callers in
  any command. No command was guarded.
- `apps/ix/bin/ix.js` stripped `--config-root` and `--no-project-config`
  from `process.argv` before oclif loaded, then `apps/ix/src/hooks/init.ts`
  mutated `Command.baseFlags` to add them back for `--help` display only —
  the flags were never actually parseable.
- `apps/ix/package.json` `oclif.plugins` was empty; built-in plugins were
  registered through the custom `registerIxPlugin` registry instead.

### Root cause

Finding 2 above ("Bootstrap order is load-bearing — `--config-root` must
be parsed before plugin manifests are loaded") was the load-bearing
assumption that justified the custom layer. On closer inspection it is
self-imposed:

- oclif plugin **discovery** does not need the config root. Plugins are
  npm packages listed in `oclif.plugins` (or installed via
  `@oclif/plugin-plugins`), found at startup regardless of config.
- The config root is only needed when a plugin's **command runs** and
  reads its **config** — by which time oclif has already parsed the
  `--config-root` flag as a normal inherited base flag.

The chicken-and-egg dissolves once the "manifest must be read before
plugin discovery" requirement is dropped. And that requirement was
itself driven by the "per-project plugin enable/disable" feature, which
was dropped during the follow-up review as not actually needed (users
who want a different plugin set ship or install a different binary).

### Outcome

StR-008 and [FR-021](../functional/core/FR-021-ix-login.md)–FR-025 have been rewritten around oclif-native
composition. `runtime-plugin-platform-plan.md` is marked superseded.
The custom `IxPlugin` contract, registry, manifest loader, distribution
object, and bin-level argv preprocessing are all being removed. The
`CapabilityResolver` implementation is retained and now consumed by
`BaseCommand.prerun`.

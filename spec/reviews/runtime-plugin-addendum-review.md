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


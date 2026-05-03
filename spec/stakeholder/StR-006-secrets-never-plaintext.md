---
id: StR-006
title: "Developer Secrets Never Persisted in Plaintext"
artifact_type: StR
relationships: []
---

## Stakeholder Need

ix-cli currently persists the developer's GitHub Container Registry token in plaintext at `~/.config/ix-local/credentials.json` (mode `0o600`). Filesystem permissions alone are an inadequate defense: backups, sync tools, container images, accidental tarballs, and shoulder-surfing all expose the token. Other developer CLIs in the same role — `gh`, `aws`, `gcloud`, Docker Desktop on macOS — store their credentials in the OS keyring (Keychain, libsecret/gnome-keyring, Windows Credential Manager) precisely because plaintext on disk is no longer acceptable practice.

**Stakeholders** — developers using `ix` on workstations, laptops, and headless WSL/CI-like environments — need:

1. Persisted secrets (GHCR PAT, IX auth refresh token, future plugin secrets) protected at rest by OS-managed encryption when available.
2. A documented, encrypted fallback when the OS keyring is unavailable (e.g. headless Linux without dbus / Secret Service), so the CLI still works without ever resorting to plaintext on disk.
3. A pluggable backend interface so the secrets layer can later target external systems (HashiCorp Vault, 1Password, Bitwarden) without rewriting consumers.
4. Per-plugin secret namespacing so a buggy or malicious plugin cannot read another plugin's secrets, and so a corrupted fallback blob for one plugin does not destroy secrets for the rest.

## Priority

Must-Have

## Acceptance

- **StR-006-AC-1**: No secret value managed by `SecretsService` is ever persisted to disk in unencrypted form. Keyring entries are protected by the OS; the file fallback is protected by an age-encrypted blob.
- **StR-006-AC-2**: When the OS keyring is available (capability probe succeeds), all `setSecret` writes target the keyring; the fallback file is never created.
- **StR-006-AC-3**: When the keyring is unavailable, secrets are stored per-plugin under `~/.config/ix/secrets.d/<plugin-id>.age`; corruption of one file does not affect secrets stored under a different plugin id.
- **StR-006-AC-4**: Secret ids are namespaced as `<plugin-id>.<secret-name>`; the API does not permit a plugin to read another plugin's secret without explicitly naming it.
- **StR-006-AC-5**: The `SecretsService` accepts additional backend adapters (Vault, 1Password, Bitwarden) via a typed interface without changes to consumer code; v1 ships keyring + age-file only.

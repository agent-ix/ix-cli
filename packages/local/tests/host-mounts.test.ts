/**
 * Host-mount catalog tests — vaultKeys entry.
 */

import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  HOST_MOUNT_CATALOG,
  resolveCatalog,
  buildHelmSetArgs,
} from "../src/host-mounts.js";

describe("vaultKeys host-mount entry", () => {
  it("is present in the canonical catalog", () => {
    const entry = HOST_MOUNT_CATALOG.find((e) => e.name === "vaultKeys");
    expect(entry).toBeDefined();
    expect(entry?.containerPath).toBe("/var/ix/vault-keys");
  });

  it("resolves to ~/.ix/vault-keys for local profile by default", () => {
    const resolved = resolveCatalog(HOST_MOUNT_CATALOG, {}, "local");
    const vk = resolved.find((m) => m.name === "vaultKeys");
    expect(vk).toBeDefined();
    expect(vk!.source.type).toBe("hostPath");
    if (vk!.source.type === "hostPath") {
      expect(vk!.source.path).toBe(
        path.join(os.homedir(), ".ix", "vault-keys"),
      );
      expect(vk!.source.hostPathType).toBe("DirectoryOrCreate");
    }
  });

  it("respects IX_VAULT_KEYS_DIR override", () => {
    const resolved = resolveCatalog(
      HOST_MOUNT_CATALOG,
      { IX_VAULT_KEYS_DIR: "/custom/keys" },
      "local",
    );
    const vk = resolved.find((m) => m.name === "vaultKeys");
    if (vk!.source.type === "hostPath") {
      expect(vk!.source.path).toBe("/custom/keys");
    }
  });

  it("emits global.hostMounts.vaultKeys.* helm args", () => {
    const resolved = resolveCatalog(HOST_MOUNT_CATALOG, {}, "local");
    const args = buildHelmSetArgs(resolved);
    const joined = args.join(" ");
    expect(joined).toContain("global.hostMounts.vaultKeys.type=hostPath");
    expect(joined).toContain(
      "global.hostMounts.vaultKeys.containerPath=/var/ix/vault-keys",
    );
    expect(joined).toMatch(
      /global\.hostMounts\.vaultKeys\.hostPath=[^ ]+\/\.ix\/vault-keys/,
    );
    expect(joined).toContain(
      "global.hostMounts.vaultKeys.hostPathType=DirectoryOrCreate",
    );
  });

  it("is omitted for non-local profiles (no source defined)", () => {
    const resolved = resolveCatalog(HOST_MOUNT_CATALOG, {}, "prod");
    const vk = resolved.find((m) => m.name === "vaultKeys");
    expect(vk).toBeUndefined();
  });
});

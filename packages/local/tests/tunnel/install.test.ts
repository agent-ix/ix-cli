/**
 * TC-423: cloudflared install credential behavior.
 *   FR-038 (Cloudflare tunnel exposure).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { runTunnelDown, runTunnelUp } from "../../src/tunnel/install.js";
import type { IxConfig } from "../../src/config.js";

vi.mock("execa");
vi.mock("../../src/namespaces.js", () => ({
  ensureNamespace: vi.fn(async () => undefined),
}));
vi.mock("../../src/tunnel/credentials.js", () => ({
  resolveCloudflareToken: vi.fn(async () => "cf-token"),
  requireCloudflareToken: vi.fn(async () => "cf-token"),
}));
vi.mock("../../src/credentials.js", () => ({
  resolveGhcrToken: vi.fn(async () => "ghcr-token"),
  resolveGhcrTokenNonInteractive: vi.fn(async () => null),
}));

const mockExeca = vi.mocked(execa);

const config: IxConfig = {
  org: "agent-ix",
  helmChartRegistry: "ghcr.io",
  imageTag: "latest",
  imageRegistry: "ghcr.io/agent-ix",
  hosts: ["dev.ix"],
  internalBaseDomain: "dev.ix",
  externalBaseDomain: null,
  enableExternalHost: false,
  publicBaseUrl: null,
  kindClusterName: "ix",
  certManagerVersion: "v1.0.0",
  ingressNginxVersion: "v1.0.0",
  certManagerTimeoutSeconds: 1,
  ingressNginxTimeoutSeconds: 1,
  certWaitTimeoutSeconds: 1,
  rolloutTimeoutSeconds: 30,
};

describe("runTunnelUp", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it("TC-423: auto-start path skips when GHCR token is absent instead of prompting", async () => {
    const result = await runTunnelUp(config, { requireToken: false });

    expect(result).toEqual({
      installed: false,
      skippedReason: "no GHCR token for cloudflared chart pull",
    });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("TC-422: tunnel down treats a missing release as success", async () => {
    mockExeca.mockRejectedValueOnce(new Error("Error: release: not found"));

    await expect(runTunnelDown()).resolves.toBeUndefined();
  });
});

/**
 * buildKindConfig — kind extraMounts mirror workstation paths.
 *
 * The kind extraMount's `containerPath` is the path inside the kind node
 * container (i.e. on the kubelet's filesystem). Pod specs reference host
 * volumes by their workstation path (the rendered `hostPath`), so the
 * kind node must expose that exact path or kubelet's HostPathType
 * `DirectoryOrCreate` will silently create an empty dir on the kind
 * node's overlay fs and persistence is lost on `kind delete cluster`.
 *
 * The pod-side mount path (`m.containerPath`, e.g. `/paperclip`) is a
 * separate concern handled by the consumer chart's volumeMount.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKindConfig } from "../src/init-cluster-controller.js";
import type { ResolvedHostMount } from "../src/host-mounts.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ix-kind-cfg-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildKindConfig", () => {
  it("emits hostPath==containerPath for hostPath mounts (kind node mirrors workstation)", () => {
    const dataPath = join(tmp, "paperclip", "data");
    const wsPath = join(tmp, "dev");
    const mounts: ResolvedHostMount[] = [
      {
        name: "paperclipData",
        containerPath: "/paperclip",
        source: {
          type: "hostPath",
          path: dataPath,
          hostPathType: "DirectoryOrCreate",
        },
      },
      {
        name: "workspace",
        containerPath: wsPath,
        source: { type: "hostPath", path: wsPath },
      },
    ];

    const yaml = buildKindConfig("test-cluster", mounts);

    // paperclipData: kind extraMount must use host path on BOTH sides so
    // pod's HostPath ${dataPath} resolves on kubelet.
    expect(yaml).toContain(`- hostPath: ${dataPath}`);
    expect(yaml).toMatch(
      new RegExp(
        `- hostPath: ${dataPath.replace(/\//g, "\\/")}\\s+containerPath: ${dataPath.replace(/\//g, "\\/")}`,
      ),
    );
    // The pod-side path (/paperclip) MUST NOT appear as a kind containerPath.
    expect(yaml).not.toMatch(/containerPath: \/paperclip$/m);
    // DirectoryOrCreate mounts should pre-create the workstation dir.
    expect(existsSync(dataPath)).toBe(true);
  });

  it("skips non-hostPath sources (pvc, csi, emptyDir don't apply to kind extraMounts)", () => {
    const mounts: ResolvedHostMount[] = [
      {
        name: "managed",
        containerPath: "/data",
        source: { type: "pvc", claimName: "my-pvc" },
      },
    ];

    const yaml = buildKindConfig("test-cluster", mounts);
    expect(yaml).not.toContain("hostPath:");
    expect(yaml).toContain("extraMounts:");
  });

  it("includes cluster name and required kind config scaffolding", () => {
    const yaml = buildKindConfig("my-cluster", []);
    expect(yaml).toContain("kind: Cluster");
    expect(yaml).toContain("name: my-cluster");
    expect(yaml).toContain("extraMounts:");
  });
});

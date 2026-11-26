import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { restartReleaseWorkloads } from "../src/workload-restart.js";

vi.mock("execa", () => ({ execa: vi.fn() }));

const mockedExeca = vi.mocked(execa);

describe("restartReleaseWorkloads", () => {
  beforeEach(() => mockedExeca.mockReset());

  it("FR-030-AC-7: restarts every supported workload using its discovered kind", async () => {
    mockedExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          items: [
            { kind: "Deployment", metadata: { name: "prometheus" } },
            { kind: "DaemonSet", metadata: { name: "promtail" } },
            { kind: "StatefulSet", metadata: { name: "loki" } },
          ],
        }),
      } as never)
      .mockResolvedValue({ stdout: "" } as never);

    await restartReleaseWorkloads("observability", "platform");

    expect(mockedExeca.mock.calls).toEqual([
      [
        "kubectl",
        [
          "get",
          "deployments,daemonsets,statefulsets",
          "-n",
          "platform",
          "-l",
          "app.kubernetes.io/part-of=observability",
          "-o",
          "json",
        ],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "deployment/prometheus", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "daemonset/promtail", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "statefulset/loki", "-n", "platform"],
        { all: true },
      ],
    ]);
  });

  it("FR-030-AC-7: skips restart when no supported workload is discovered", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ items: [] }),
    } as never);

    await restartReleaseWorkloads("config-only", "platform");

    expect(mockedExeca.mock.calls).toEqual([
      [
        "kubectl",
        [
          "get",
          "deployments,daemonsets,statefulsets",
          "-n",
          "platform",
          "-l",
          "app.kubernetes.io/part-of=config-only",
          "-o",
          "json",
        ],
        { all: true },
      ],
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { restartReleaseWorkloads } from "../src/workload-restart.js";

vi.mock("execa", () => ({ execa: vi.fn() }));

const mockedExeca = vi.mocked(execa);

describe("restartReleaseWorkloads", () => {
  beforeEach(() => mockedExeca.mockReset());

  it("TC-293: restarts every supported workload (Trace: FR-030-AC-7)", async () => {
    mockedExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          items: [
            { kind: "Deployment", metadata: { name: "prometheus" } },
            { kind: "Deployment", metadata: { name: "alertmanager" } },
            { kind: "DaemonSet", metadata: { name: "promtail" } },
            { kind: "DaemonSet", metadata: { name: "node-exporter" } },
            { kind: "StatefulSet", metadata: { name: "loki" } },
            { kind: "StatefulSet", metadata: { name: "tempo" } },
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
        ["rollout", "restart", "deployment/alertmanager", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "daemonset/promtail", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "daemonset/node-exporter", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "statefulset/loki", "-n", "platform"],
        { all: true },
      ],
      [
        "kubectl",
        ["rollout", "restart", "statefulset/tempo", "-n", "platform"],
        { all: true },
      ],
    ]);
  });

  it("TC-294: skips restart when no workload is found (Trace: FR-030-AC-7)", async () => {
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

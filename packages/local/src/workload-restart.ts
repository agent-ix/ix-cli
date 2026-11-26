import { execa } from "execa";

const RESOURCE_BY_KIND: Readonly<Record<string, string>> = {
  Deployment: "deployment",
  DaemonSet: "daemonset",
  StatefulSet: "statefulset",
};

interface KubernetesWorkload {
  kind?: unknown;
  metadata?: { name?: unknown };
}

// Implements: FR-030-AC-7
/** Restart release workloads using their discovered Kubernetes resource kinds. */
export async function restartReleaseWorkloads(
  releaseName: string,
  namespace: string,
): Promise<void> {
  const { stdout } = await execa(
    "kubectl",
    [
      "get",
      "deployments,daemonsets,statefulsets",
      "-n",
      namespace,
      "-l",
      `app.kubernetes.io/part-of=${releaseName}`,
      "-o",
      "json",
    ],
    { all: true },
  );
  const workloads = (JSON.parse(stdout) as { items?: KubernetesWorkload[] })
    .items;

  for (const workload of workloads ?? []) {
    if (typeof workload.kind !== "string") continue;
    const resource = RESOURCE_BY_KIND[workload.kind];
    if (!resource || typeof workload.metadata?.name !== "string") continue;

    await execa(
      "kubectl",
      [
        "rollout",
        "restart",
        `${resource}/${workload.metadata.name}`,
        "-n",
        namespace,
      ],
      { all: true },
    );
  }
}

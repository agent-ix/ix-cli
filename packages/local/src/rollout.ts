/**
 * FR-010 — Rollout Wait & URL Reporting
 * kubectl rollout status with configurable timeout; streams output to task.output.
 * Optionally surfaces pod ready counts via onStatus callback.
 */

import { execa } from "execa";
import type { ListrTaskWrapper } from "listr2";

/**
 * Extract a human-readable failure reason from pod state after a rollout fails.
 * Checks container waiting/terminated reasons (CrashLoopBackOff, OOMKilled, etc.)
 * and falls back to the most recent Warning event for the deployment.
 */
export async function diagnosePodFailure(
  labelSelector: string,
  namespace: string,
): Promise<string | null> {
  try {
    // Get container state reasons from all pods matching the selector.
    const { stdout: podJson } = await execa(
      "kubectl",
      ["get", "pods", "-n", namespace, "-l", labelSelector, "-o", "json"],
      { all: true },
    );
    const pods = (JSON.parse(podJson) as { items: unknown[] }).items as Array<{
      metadata: { name: string };
      status: {
        containerStatuses?: Array<{
          name: string;
          state: {
            waiting?: { reason?: string; message?: string };
            terminated?: {
              reason?: string;
              message?: string;
              exitCode?: number;
            };
          };
          lastState?: {
            terminated?: { reason?: string; exitCode?: number };
          };
        }>;
      };
    }>;

    for (const pod of pods) {
      for (const cs of pod.status.containerStatuses ?? []) {
        const w = cs.state.waiting;
        if (
          w?.reason &&
          w.reason !== "PodInitializing" &&
          w.reason !== "ContainerCreating"
        ) {
          const detail = w.message
            ? ` (${w.message.split("\n")[0].replace(/\s+(?:container|pod)=\S+/g, "")})`
            : "";
          return `${w.reason}${detail}`;
        }
        const t = cs.state.terminated;
        if (t?.reason && t.reason !== "Completed") {
          return `${t.reason} (exit ${t.exitCode ?? "?"})`;
        }
        // CrashLoopBackOff shows in lastState.terminated
        const lt = cs.lastState?.terminated;
        if (lt?.reason) {
          const waiting = w?.reason ?? "";
          return waiting
            ? `${waiting} — last exit: ${lt.reason} (exit ${lt.exitCode ?? "?"})`
            : `${lt.reason} (exit ${lt.exitCode ?? "?"})`;
        }
      }
    }
  } catch {
    // ignore — pod may not exist
  }

  // Fall back to the most recent Warning event for the selector.
  try {
    const { stdout: eventsJson } = await execa(
      "kubectl",
      [
        "get",
        "events",
        "-n",
        namespace,
        "--field-selector",
        "type=Warning",
        "-o",
        "json",
      ],
      { all: true },
    );
    const events = (
      JSON.parse(eventsJson) as {
        items: Array<{
          lastTimestamp: string;
          message: string;
          involvedObject: { name: string };
        }>;
      }
    ).items
      .filter((e) =>
        e.involvedObject.name
          .toLowerCase()
          .includes(labelSelector.split("=")[1]?.toLowerCase() ?? ""),
      )
      .sort(
        (a, b) =>
          new Date(b.lastTimestamp).getTime() -
          new Date(a.lastTimestamp).getTime(),
      );
    if (events.length > 0) return events[0].message.split("\n")[0];
  } catch {
    // ignore
  }

  return null;
}

/**
 * Reads ready/desired replica counts directly from the workload resource.
 * Works for both Deployments and StatefulSets — both expose
 * .status.readyReplicas and .spec.replicas.
 */
async function getDeploymentStatus(
  deployments: string[],
  namespace: string,
): Promise<string> {
  let readySum = 0;
  let totalSum = 0;
  for (const dep of deployments) {
    try {
      const { stdout } = await execa(
        "kubectl",
        [
          "get",
          dep,
          "-n",
          namespace,
          "-o",
          "jsonpath={.status.readyReplicas}/{.spec.replicas}",
        ],
        { all: true },
      );
      const [r, t] = stdout.split("/");
      readySum += parseInt(r) || 0;
      totalSum += parseInt(t) || 1;
    } catch {
      // ignore — deployment may not exist yet
    }
  }
  return `${readySum}/${totalSum}`;
}

/**
 * Wait for a Kubernetes rollout to complete.
 * FR-010-AC-1: streams kubectl output to task.output
 * FR-010-AC-2: honours timeoutSeconds (→ --timeout flag)
 * FR-010-AC-3: rejects on non-zero exit (task fails, process exits 1)
 *
 * @param svc             — service/deployment name
 * @param namespace       — k8s namespace (default: "default")
 * @param timeoutSeconds  — timeout in seconds
 * @param task            — Listr2 task for output streaming
 * @param labelSelector   — optional label selector to find deployments
 * @param onStatus        — optional callback receiving live pod ready counts
 */
export async function waitForRollout(
  svc: string,
  namespace: string,
  timeoutSeconds: number,
  task: ListrTaskWrapper<unknown, never, never>,
  labelSelector?: string,
  onStatus?: (status: string) => void,
): Promise<void> {
  const deployments = labelSelector
    ? (
        await execa(
          "kubectl",
          [
            "get",
            "deployments,statefulsets",
            "-n",
            namespace,
            "-l",
            labelSelector,
            "-o",
            "name",
          ],
          { all: true },
        )
      ).stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [`deployment/${svc}`];

  if (deployments.length === 0) {
    throw new Error(
      `No workloads (deployment/statefulset) found for selector '${labelSelector}' in namespace '${namespace}'`,
    );
  }

  // Emit initial ready count before rollout status starts streaming.
  if (onStatus) {
    onStatus(await getDeploymentStatus(deployments, namespace));
  }

  for (const deployment of deployments) {
    const subprocess = execa(
      "kubectl",
      [
        "rollout",
        "status",
        deployment,
        "-n",
        namespace,
        `--timeout=${timeoutSeconds}s`, // FR-010-AC-2
      ],
      { all: true },
    );

    subprocess.all?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) {
        task.output = line; // FR-010-AC-4
        // Parse "N of M" from rollout status output for live updates.
        if (onStatus) {
          const match = line.match(/: (\d+) of (\d+)/);
          if (match) onStatus(`${match[1]}/${match[2]}`);
        }
      }
    });

    await subprocess; // FR-010-AC-3: throws on non-zero exit
  }

  // Emit final count once rollout is confirmed complete.
  if (onStatus) {
    onStatus(await getDeploymentStatus(deployments, namespace));
  }
}

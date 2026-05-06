/**
 * FR-010 — Rollout Wait & URL Reporting
 * kubectl rollout status with configurable timeout; streams output to task.output.
 * Optionally surfaces pod ready counts via onStatus callback.
 */

import { execa } from "execa";
import type { ListrTaskWrapper } from "listr2";

export interface HookFailure {
  jobName: string;
  message: string;
}

export interface HookStatus extends HookFailure {
  phase: "running" | "failed";
}

interface HookJob {
  metadata: {
    name: string;
    annotations?: Record<string, string>;
  };
  status?: {
    conditions?: Array<{
      type?: string;
      status?: string;
    }>;
  };
}

function isFailedHookJob(job: HookJob): boolean {
  if (!job.metadata.annotations?.["helm.sh/hook"]) return false;
  return (
    job.status?.conditions?.some(
      (c) => c.type === "Failed" && c.status === "True",
    ) ?? false
  );
}

/**
 * Removes failed Helm hook Jobs for a release before retrying an install.
 * Helm normally honors hook-delete-policy=before-hook-creation, but a failed
 * retry can still encounter stale hook Jobs from a prior interrupted/failed
 * attempt. Only Jobs already marked Failed are deleted.
 */
export async function cleanupFailedHelmHookJobs(
  namespace: string,
  releaseName: string,
): Promise<string[]> {
  const { stdout } = await execa(
    "kubectl",
    [
      "get",
      "jobs",
      "-n",
      namespace,
      "-l",
      `app.kubernetes.io/instance=${releaseName}`,
      "-o",
      "json",
    ],
    { all: true },
  );
  const jobs = (JSON.parse(stdout) as { items: unknown[] }).items as HookJob[];
  const failedHookJobs = jobs.filter(isFailedHookJob);

  for (const job of failedHookJobs) {
    await execa("kubectl", [
      "delete",
      "job",
      job.metadata.name,
      "-n",
      namespace,
      "--ignore-not-found=true",
    ]);
  }

  return failedHookJobs.map((job) => job.metadata.name);
}

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
 * Maps container waiting reasons to short human-readable labels for the
 * ready-phase status column (e.g. "0/1·init"). Returns null on any error
 * so the caller can fall back to the bare count string.
 */
async function getPodReadyLabel(
  labelSelector: string,
  namespace: string,
): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "kubectl",
      ["get", "pods", "-n", namespace, "-l", labelSelector, "-o", "json"],
      { all: true },
    );
    const pods = (JSON.parse(stdout) as { items: unknown[] }).items as Array<{
      status: {
        initContainerStatuses?: Array<{ ready: boolean }>;
        containerStatuses?: Array<{
          state: { waiting?: { reason?: string } };
        }>;
      };
    }>;

    if (pods.length === 0) return "sched";

    for (const pod of pods) {
      if ((pod.status.initContainerStatuses ?? []).some((ic) => !ic.ready))
        return "init";
      for (const cs of pod.status.containerStatuses ?? []) {
        const reason = cs.state.waiting?.reason;
        if (reason === "PodInitializing") return "init";
        if (reason === "ContainerCreating") return "start";
      }
    }
    return "start";
  } catch {
    return null;
  }
}

/**
 * Non-transient waiting reasons that indicate a pod will not self-recover.
 * Used by the early-failure poller to abort rollout watches fast.
 */
const TERMINAL_WAITING_REASONS = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "InvalidImageName",
  "RunContainerError",
  "OOMKilled",
]);

/**
 * Checks whether any pod matching labelSelector is stuck in a terminal
 * waiting or terminated state. Returns the reason string, or null if
 * everything looks transient / still starting.
 */
async function detectTerminalFailure(
  labelSelector: string,
  namespace: string,
): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "kubectl",
      ["get", "pods", "-n", namespace, "-l", labelSelector, "-o", "json"],
      { all: true },
    );
    const pods = (JSON.parse(stdout) as { items: unknown[] }).items as Array<{
      status: {
        containerStatuses?: Array<{
          state: {
            waiting?: { reason?: string };
            terminated?: { reason?: string; exitCode?: number };
          };
        }>;
      };
    }>;
    for (const pod of pods) {
      for (const cs of pod.status.containerStatuses ?? []) {
        const wr = cs.state.waiting?.reason;
        if (wr && TERMINAL_WAITING_REASONS.has(wr)) return wr;
        const tr = cs.state.terminated?.reason;
        if (tr && tr !== "Completed") {
          return `${tr} (exit ${cs.state.terminated?.exitCode ?? "?"})`;
        }
      }
    }
  } catch {
    // pod may not exist yet
  }
  return null;
}

function summarizeWaitingFailure(reason: string, message?: string): string {
  const detail = message
    ? ` (${message.split("\n")[0].replace(/\s+(?:container|pod)=\S+/g, "")})`
    : "";
  return `${reason}${detail}`;
}

/**
 * Detect a failing Helm hook job while `helm upgrade --install` is still
 * running. This allows the caller to abort early instead of waiting for Helm's
 * hook timeout/deadline.
 */
export async function detectHelmHookFailure(
  namespace: string,
  releaseName: string,
): Promise<HookFailure | null> {
  const status = (await detectHelmHookStatuses(namespace, releaseName)).find(
    (s) => s.phase === "failed",
  );
  if (status) {
    return { jobName: status.jobName, message: status.message };
  }
  return null;
}

function latestNonEmptyLine(output: string): string | null {
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? null
  );
}

/**
 * Observes Helm hook jobs while `helm upgrade --install` is still running.
 * Failed terminal pod/job states are returned as `failed`; active hook pods
 * return their latest log line so the caller can show progress only on the
 * service row that owns the hook.
 */
export async function detectHelmHookStatus(
  namespace: string,
  releaseName: string,
): Promise<HookStatus | null> {
  return (await detectHelmHookStatuses(namespace, releaseName))[0] ?? null;
}

export async function detectHelmHookStatuses(
  namespace: string,
  releaseName: string,
): Promise<HookStatus[]> {
  const statuses: HookStatus[] = [];
  try {
    const { stdout } = await execa(
      "kubectl",
      [
        "get",
        "jobs",
        "-n",
        namespace,
        "-l",
        `app.kubernetes.io/instance=${releaseName}`,
        "-o",
        "json",
      ],
      { all: true },
    );
    const jobs = (JSON.parse(stdout) as { items: unknown[] }).items as Array<{
      metadata: {
        name: string;
        annotations?: Record<string, string>;
      };
      status?: {
        active?: number;
        conditions?: Array<{
          type?: string;
          status?: string;
          reason?: string;
          message?: string;
        }>;
      };
    }>;

    for (const job of jobs) {
      if (!job.metadata.annotations?.["helm.sh/hook"]) continue;

      const { stdout: podStdout } = await execa(
        "kubectl",
        [
          "get",
          "pods",
          "-n",
          namespace,
          "-l",
          `job-name=${job.metadata.name}`,
          "-o",
          "json",
        ],
        { all: true },
      );
      const pods = (JSON.parse(podStdout) as { items: unknown[] })
        .items as Array<{
        metadata: { name: string };
        status: {
          containerStatuses?: Array<{
            state: {
              running?: Record<string, never>;
              waiting?: { reason?: string; message?: string };
              terminated?: { reason?: string; exitCode?: number };
            };
          }>;
        };
      }>;

      for (const pod of pods) {
        for (const cs of pod.status.containerStatuses ?? []) {
          const waiting = cs.state.waiting;
          if (waiting?.reason && TERMINAL_WAITING_REASONS.has(waiting.reason)) {
            statuses.push({
              jobName: job.metadata.name,
              phase: "failed",
              message: summarizeWaitingFailure(waiting.reason, waiting.message),
            });
            continue;
          }
          const terminated = cs.state.terminated;
          if (terminated?.reason && terminated.reason !== "Completed") {
            statuses.push({
              jobName: job.metadata.name,
              phase: "failed",
              message: `${terminated.reason} (exit ${terminated.exitCode ?? "?"})`,
            });
            continue;
          }
        }
      }
      if (statuses.some((status) => status.jobName === job.metadata.name)) {
        continue;
      }

      const failed = job.status?.conditions?.find(
        (c) => c.type === "Failed" && c.status === "True",
      );
      if (failed) {
        statuses.push({
          jobName: job.metadata.name,
          phase: "failed",
          message:
            failed.message?.trim() ||
            failed.reason?.trim() ||
            "Helm hook job failed",
        });
        continue;
      }

      let runningStatus: HookStatus | null = null;
      for (const pod of pods) {
        const hasRunningContainer = (pod.status.containerStatuses ?? []).some(
          (cs) => cs.state.running,
        );
        if (!hasRunningContainer) continue;
        try {
          const { stdout: logs } = await execa(
            "kubectl",
            ["logs", pod.metadata.name, "-n", namespace, "--tail=20"],
            { all: true },
          );
          runningStatus = {
            jobName: job.metadata.name,
            phase: "running",
            message: latestNonEmptyLine(logs) ?? "hook running",
          };
          break;
        } catch {
          runningStatus = {
            jobName: job.metadata.name,
            phase: "running",
            message: "hook running",
          };
          break;
        }
      }

      if (runningStatus) {
        statuses.push(runningStatus);
        continue;
      }

      if ((job.status?.active ?? 0) > 0 || pods.length > 0) {
        statuses.push({
          jobName: job.metadata.name,
          phase: "running",
          message: "hook running",
        });
      }
    }
  } catch {
    // Ignore transient API errors; caller will continue normal helm/watch flow.
  }

  return statuses;
}

interface WorkloadJson {
  kind?: string;
  metadata?: {
    generation?: number;
  };
  spec?: {
    replicas?: number;
  };
  status?: {
    availableReplicas?: number;
    currentRevision?: string;
    observedGeneration?: number;
    readyReplicas?: number;
    replicas?: number;
    updatedReplicas?: number;
    updateRevision?: string;
  };
}

function workloadReplicaStatus(workload: WorkloadJson): {
  ready: number;
  total: number;
  settling: boolean;
} {
  const total = workload.spec?.replicas ?? workload.status?.replicas ?? 1;
  const ready = workload.status?.readyReplicas ?? 0;
  const available = workload.status?.availableReplicas;
  const updated = workload.status?.updatedReplicas;
  const observed = workload.status?.observedGeneration ?? 0;
  const generation = workload.metadata?.generation ?? 0;
  const currentRevision = workload.status?.currentRevision;
  const updateRevision = workload.status?.updateRevision;
  const revisionMismatch =
    currentRevision != null &&
    updateRevision != null &&
    currentRevision !== updateRevision;
  const settling =
    ready === total &&
    (observed < generation ||
      (available != null && available < total) ||
      (updated != null && updated < total) ||
      revisionMismatch);

  return { ready, total, settling };
}

/**
 * Reads ready/desired replica counts directly from the workload resource.
 * Works for both Deployments and StatefulSets. A full ready count is still
 * marked as settling until the controller has observed the latest generation,
 * made desired replicas available, and updated desired replicas to the new
 * revision.
 */
async function getDeploymentStatus(
  deployments: string[],
  namespace: string,
): Promise<string> {
  let readySum = 0;
  let totalSum = 0;
  let settling = false;
  for (const dep of deployments) {
    try {
      const { stdout } = await execa(
        "kubectl",
        ["get", dep, "-n", namespace, "-o", "json"],
        { all: true },
      );
      const workload = JSON.parse(stdout) as WorkloadJson;
      const {
        ready,
        total,
        settling: workloadSettling,
      } = workloadReplicaStatus(workload);
      readySum += ready;
      totalSum += total;
      if (workloadSettling) {
        settling = true;
      }
    } catch {
      // ignore — deployment may not exist yet
    }
  }
  const base = `${readySum}/${totalSum}`;
  if (settling) return `${base}·settle`;
  return base;
}

export async function getRolloutReadyStatus(
  svc: string,
  namespace: string,
  labelSelector?: string,
): Promise<string | null> {
  try {
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

    if (deployments.length === 0) return null;

    const pollSelector = labelSelector ?? `app=${svc}`;
    const base = await getDeploymentStatus(deployments, namespace);
    if (parseInt(base, 10) === 0) {
      const label = await getPodReadyLabel(pollSelector, namespace);
      return label ? `${base}·${label}` : base;
    }
    return base;
  } catch {
    return null;
  }
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
  task: ListrTaskWrapper<unknown, never, never> | undefined,
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

  const pollSelector = labelSelector ?? `app=${svc}`;

  async function emitStatus(base: string): Promise<void> {
    if (!onStatus) return;
    if (parseInt(base, 10) === 0) {
      const label = await getPodReadyLabel(pollSelector, namespace);
      onStatus(label ? `${base}·${label}` : base);
    } else {
      onStatus(base);
    }
  }

  // Emit initial ready count before rollout status starts streaming.
  await emitStatus(await getDeploymentStatus(deployments, namespace));

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
        if (task) task.output = line; // FR-010-AC-4
        // Parse "N of M" from rollout status output for live updates.
        if (onStatus) {
          const match = line.match(/: (\d+) of (\d+)/);
          if (match) {
            const countStr = `${match[1]}/${match[2]}`;
            void emitStatus(countStr);
          }
        }
      }
    });

    // Poll for terminal pod states every 1 s so we abort immediately instead
    // of waiting for the full --timeout when pods are stuck in e.g. CrashLoopBackOff.
    let earlyFailure: string | null = null;
    const checkOnce = () => {
      void detectTerminalFailure(pollSelector, namespace).then((reason) => {
        if (reason && !earlyFailure) {
          earlyFailure = reason;
          subprocess.kill();
        }
      });
    };
    checkOnce();
    const poller = setInterval(checkOnce, 1000);

    try {
      await subprocess; // FR-010-AC-3: throws on non-zero exit
    } catch (err) {
      if (earlyFailure) {
        throw new Error(`Rollout failed: ${earlyFailure}`);
      }
      throw err;
    } finally {
      clearInterval(poller);
    }
  }

  // Emit final count once rollout is confirmed complete.
  await emitStatus(await getDeploymentStatus(deployments, namespace));
}

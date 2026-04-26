/**
 * FR-007 — cluster status
 * Read-only node + unhealthy pod health summary.
 */

import { execa } from "execa";
import pc from "picocolors";
import Table from "cli-table3";
import { outroSuccess, outroError } from "@agent-ix/ix-ui-cli";

interface NodeItem {
  metadata: { name: string; creationTimestamp: string };
  status: { conditions: Array<{ type: string; status: string }> };
  spec?: { taints?: Array<{ effect: string }> };
}

interface PodItem {
  metadata: { name: string; namespace: string };
  status: {
    phase?: string;
    containerStatuses?: Array<{
      restartCount: number;
      state?: Record<string, unknown>;
    }>;
  };
}

function nodeRole(node: NodeItem): string {
  const isControlPlane =
    node.spec?.taints?.some((t) => t.effect === "NoSchedule") ?? false;
  return isControlPlane ? "control-plane" : "worker";
}

function nodeReady(node: NodeItem): string {
  const ready = node.status.conditions.find((c) => c.type === "Ready");
  return ready?.status === "True" ? pc.green("Ready") : pc.red("NotReady");
}

function nodeAge(node: NodeItem): string {
  const diffMs =
    Date.now() - new Date(node.metadata.creationTimestamp).getTime();
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return days > 0 ? `${days}d` : `${hours}h`;
}

function podRestarts(pod: PodItem): number {
  return (pod.status.containerStatuses ?? []).reduce(
    (sum, cs) => sum + cs.restartCount,
    0,
  );
}

const HEALTHY_PHASES = new Set(["Running", "Succeeded"]);

export async function runClusterStatus(): Promise<void> {
  let nodesJson: string;
  try {
    const { stdout } = await execa("kubectl", ["get", "nodes", "-o", "json"]);
    nodesJson = stdout;
  } catch (err) {
    outroError(
      `Cannot reach cluster: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new Error("kubectl get nodes failed — is the cluster running?");
  }

  const nodes: NodeItem[] = (JSON.parse(nodesJson) as { items: NodeItem[] })
    .items;

  const nodeTable = new Table({
    head: ["NAME", "ROLE", "STATUS", "AGE"],
    style: { head: ["cyan"] },
  });
  for (const n of nodes) {
    nodeTable.push([n.metadata.name, nodeRole(n), nodeReady(n), nodeAge(n)]);
  }
  process.stdout.write(nodeTable.toString() + "\n");

  const { stdout: podsJson } = await execa("kubectl", [
    "get",
    "pods",
    "-A",
    "-o",
    "json",
  ]);
  const pods: PodItem[] = (JSON.parse(podsJson) as { items: PodItem[] }).items;
  const unhealthy = pods.filter(
    (pod) => !HEALTHY_PHASES.has(pod.status.phase ?? ""),
  );

  if (unhealthy.length === 0) {
    outroSuccess("All pods healthy.");
    return;
  }

  const podTable = new Table({
    head: ["NAMESPACE", "NAME", "PHASE", "RESTARTS"],
    style: { head: ["cyan"] },
  });
  for (const pod of unhealthy) {
    podTable.push([
      pod.metadata.namespace,
      pod.metadata.name,
      pc.red(pod.status.phase ?? "Unknown"),
      String(podRestarts(pod)),
    ]);
  }
  process.stdout.write(podTable.toString() + "\n");
}

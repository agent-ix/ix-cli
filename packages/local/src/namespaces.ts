/**
 * Namespace lifecycle helpers for install orchestration.
 *
 * Install steps (ghcr-creds, secret contracts) write into the target namespace
 * before `helm install --create-namespace` runs, so the namespace must exist
 * first. `ensureNamespace` is idempotent via `kubectl apply`.
 */

import { execa } from "execa";

export async function ensureNamespace(namespace: string): Promise<void> {
  const manifest = [
    "apiVersion: v1",
    "kind: Namespace",
    "metadata:",
    `  name: ${namespace}`,
    "",
  ].join("\n");
  await execa("kubectl", ["apply", "-f", "-"], { input: manifest });
}

/**
 * FR-019 — admin-bootstrap Secret Contract
 * Single shared write path used by FR-015 (init-admin-seed) and
 * FR-016 (reset-admin). Both call writeAdminBootstrapSecret() — this is the
 * only function that may write the ix-system/admin-bootstrap Secret.
 */

import { execa } from "execa";

export interface AdminBootstrapPayload {
  password: string;
  expiresAt: string; // RFC3339
  userId: string; // UUID
  loginUrl: string;
}

/**
 * Build a YAML manifest for the ix-system/admin-bootstrap Secret (FR-019).
 * All data values are base64-encoded (single encoding — the K8s `data` field
 * is already base64; we do not double-encode).
 */
function buildAdminBootstrapManifest(payload: AdminBootstrapPayload): string {
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: admin-bootstrap",
    "  namespace: ix-system",
    "  labels:",
    '    app.kubernetes.io/managed-by: "ix-local-cli"',
    '    ix/purpose: "admin-bootstrap"',
    "  annotations:",
    `    ix/admin-user-id: "${payload.userId}"`,
    `    ix/expires-at: "${payload.expiresAt}"`,
    "type: Opaque",
    "data:",
    `  password: ${b64(payload.password)}`,
    `  expires_at: ${b64(payload.expiresAt)}`,
    `  user_id: ${b64(payload.userId)}`,
    `  login_url: ${b64(payload.loginUrl)}`,
    "",
  ].join("\n");
}

/**
 * Write (or overwrite) the ix-system/admin-bootstrap Secret via kubectl apply
 * with server-side apply and field manager ix-local-cli.
 *
 * The manifest is piped via stdin so the password value never appears on the
 * kubectl command line (FR-019-CON-4, FR-016-CON-2).
 */
export async function writeAdminBootstrapSecret(
  payload: AdminBootstrapPayload,
): Promise<void> {
  const manifest = buildAdminBootstrapManifest(payload);

  await execa(
    "kubectl",
    [
      "apply",
      "--server-side",
      "--field-manager",
      "ix-local-cli",
      "--force-conflicts",
      "-f",
      "-",
    ],
    { input: manifest },
  );
}

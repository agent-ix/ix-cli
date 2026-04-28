/**
 * FR-020 — auth config Subcommands
 * Manages identity configuration (email, password-reset, social, registration)
 * by updating ConfigMap ix-system/identity-config and Secret ix-system/identity-secrets,
 * then rolling out identity deployment.
 */

import { execa } from "execa";
import type { IxConfig } from "../config.js";
import { IX_AUTH_NAMESPACE } from "./auth-identity.js";
import { startListing, makeListr } from "@agent-ix/ix-ui-cli";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function kubectlGetJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execa("kubectl", args);
  return JSON.parse(stdout) as T;
}

async function ensureIdentityDeploymentExists(): Promise<void> {
  try {
    await execa("kubectl", [
      "get",
      "deployment/identity",
      "-n",
      IX_AUTH_NAMESPACE,
      "--ignore-not-found=false",
      "-o",
      "name",
    ]);
  } catch {
    throw new Error(
      `identity service not found in namespace ${IX_AUTH_NAMESPACE}`,
    );
  }
}

async function getConfigMap(): Promise<Record<string, string>> {
  try {
    const cm = await kubectlGetJson<{
      data?: Record<string, string>;
    }>([
      "get",
      "configmap/identity-config",
      "-n",
      IX_AUTH_NAMESPACE,
      "-o",
      "json",
    ]);
    return cm.data ?? {};
  } catch {
    return {};
  }
}

async function getSecretData(): Promise<Record<string, string>> {
  try {
    const secret = await kubectlGetJson<{
      data?: Record<string, string>;
    }>([
      "get",
      "secret/identity-secrets",
      "-n",
      IX_AUTH_NAMESPACE,
      "-o",
      "json",
    ]);
    // Decode base64 values
    const raw = secret.data ?? {};
    const decoded: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      decoded[k] = Buffer.from(v, "base64").toString("utf-8");
    }
    return decoded;
  } catch {
    return {};
  }
}

function buildConfigMapManifest(data: Record<string, string>): string {
  const dataLines = Object.entries(data)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join("\n");
  return [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: identity-config",
    `  namespace: ${IX_AUTH_NAMESPACE}`,
    "data:",
    dataLines,
    "",
  ].join("\n");
}

function buildSecretManifest(data: Record<string, string>): string {
  const dataLines = Object.entries(data)
    .map(([k, v]) => `  ${k}: ${Buffer.from(v, "utf-8").toString("base64")}`)
    .join("\n");
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: identity-secrets",
    `  namespace: ${IX_AUTH_NAMESPACE}`,
    "type: Opaque",
    "data:",
    dataLines,
    "",
  ].join("\n");
}

async function applyManifest(manifest: string): Promise<void> {
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

async function rolloutIdentity(timeoutSeconds: number): Promise<void> {
  await execa("kubectl", [
    "rollout",
    "restart",
    "deployment/identity",
    "-n",
    IX_AUTH_NAMESPACE,
  ]);
  await execa("kubectl", [
    "rollout",
    "status",
    "deployment/identity",
    "-n",
    IX_AUTH_NAMESPACE,
    `--timeout=${timeoutSeconds}s`,
  ]);
}

/**
 * Shared Listr task set for mutations: apply ConfigMap+Secret then rollout.
 */
function mutationTasks(
  cmData: Record<string, string>,
  secretData: Record<string, string>,
  rolloutTimeoutSeconds: number,
) {
  return [
    {
      title: "Checking identity deployment",
      task: async () => {
        await ensureIdentityDeploymentExists();
      },
    },
    {
      title: "Applying identity ConfigMap",
      task: async (ctx: unknown, task: { output: string }) => {
        await applyManifest(buildConfigMapManifest(cmData));
        task.output = "identity-config applied";
      },
    },
    {
      title: "Applying identity-secrets",
      task: async (ctx: unknown, task: { output: string }) => {
        await applyManifest(buildSecretManifest(secretData));
        task.output = "identity-secrets applied";
      },
    },
    {
      title: "Rolling out identity deployment",
      task: async (ctx: unknown, task: { output: string }) => {
        task.output = "Waiting for identity rollout...";
        await rolloutIdentity(rolloutTimeoutSeconds);
        task.output = "identity rollout complete";
      },
    },
  ];
}

function makeMutationListr(
  cmData: Record<string, string>,
  secretData: Record<string, string>,
  rolloutTimeoutSeconds: number,
) {
  return makeListr(mutationTasks(cmData, secretData, rolloutTimeoutSeconds), {
    concurrent: false,
  });
}

// ---------------------------------------------------------------------------
// auth config email
// ---------------------------------------------------------------------------

export async function runAuthConfigEmailEnable(
  _config: IxConfig,
  opts: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    from: string;
    noStarttls?: boolean;
    rolloutTimeout?: number;
  },
  smtpPassword: string,
): Promise<void> {
  const list = startListing("ix local auth config email enable");
  list.commit();

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  cmData["email.enabled"] = "true";
  cmData["email.smtp_host"] = opts.smtpHost;
  cmData["email.smtp_port"] = String(opts.smtpPort);
  cmData["email.smtp_user"] = opts.smtpUser;
  cmData["email.from"] = opts.from;
  cmData["email.starttls"] = opts.noStarttls ? "false" : "true";

  // Secret field for SMTP password (FR-020-CON-1)
  secretData["email.smtp_password"] = smtpPassword;

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success("Email configuration enabled and identity restarted.");
  } catch (err) {
    list.error(
      `auth config email enable failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigEmailDisable(
  _config: IxConfig,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const list = startListing("ix local auth config email disable");
  list.commit();

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  cmData["email.enabled"] = "false";

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success("Email configuration disabled and identity restarted.");
  } catch (err) {
    list.error(
      `auth config email disable failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigEmailShow(_config: IxConfig): Promise<void> {
  const list = startListing("ix local auth config email show");
  list.commit();

  const cmData = await getConfigMap();

  // FR-020-AC-3: NEVER print the password
  const lines = [
    `enabled:   ${cmData["email.enabled"] ?? "false"}`,
    `smtp_host: ${cmData["email.smtp_host"] ?? "(not set)"}`,
    `smtp_port: ${cmData["email.smtp_port"] ?? "(not set)"}`,
    `smtp_user: ${cmData["email.smtp_user"] ?? "(not set)"}`,
    `from:      ${cmData["email.from"] ?? "(not set)"}`,
    `starttls:  ${cmData["email.starttls"] ?? "(not set)"}`,
    `password:  ***`,
  ];

  for (const line of lines) list.note(line);
  list.success("email configuration");
}

export async function runAuthConfigEmailTest(
  _config: IxConfig,
  to: string,
): Promise<void> {
  const list = startListing("ix local auth config email test");
  list.commit();

  const tasks = makeListr(
    [
      {
        title: "Checking identity deployment",
        task: async () => {
          await ensureIdentityDeploymentExists();
        },
      },
      {
        title: `Sending test email to ${to}`,
        task: async (ctx, task) => {
          // Trigger test email via identity internal API
          await execa("kubectl", [
            "exec",
            "-n",
            IX_AUTH_NAMESPACE,
            "deployment/identity",
            "--",
            "python",
            "-c",
            `import requests; r = requests.post("http://localhost:8000/internal/email/test", json={"to": "${to}"}); r.raise_for_status()`,
          ]);
          task.output = `Test email sent to ${to}`;
        },
      },
    ],
    { concurrent: false },
  );

  try {
    await tasks.run();
    list.success(`Test email sent to ${to}.`);
  } catch (err) {
    list.error(
      `auth config email test failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// auth config password-reset
// ---------------------------------------------------------------------------

const VALID_PR_MODES = ["cli_only", "email", "disabled"] as const;
type PasswordResetMode = (typeof VALID_PR_MODES)[number];

export async function runAuthConfigPasswordResetSet(
  _config: IxConfig,
  mode: string,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const list = startListing("ix local auth config password-reset set");
  list.commit();

  if (!VALID_PR_MODES.includes(mode as PasswordResetMode)) {
    const msg = `Invalid mode '${mode}'. Valid values: ${VALID_PR_MODES.join(", ")}`;
    list.error(msg);
    throw new Error(msg);
  }

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  // FR-020-AC-6: email mode requires email to be enabled first
  if (mode === "email" && cmData["email.enabled"] !== "true") {
    const msg =
      "password-reset=email requires email to be enabled first. Run: ix local auth config email enable ...";
    list.error(msg);
    throw new Error(msg);
  }

  cmData["password_reset.mode"] = mode;

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success(
      `Password reset mode set to '${mode}' and identity restarted.`,
    );
  } catch (err) {
    list.error(
      `auth config password-reset set failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigPasswordResetShow(
  _config: IxConfig,
): Promise<void> {
  const list = startListing("ix local auth config password-reset show");
  list.commit();

  const cmData = await getConfigMap();

  list.success(
    `password-reset.mode: ${cmData["password_reset.mode"] ?? "(not set)"}`,
  );
}

// ---------------------------------------------------------------------------
// auth config social
// ---------------------------------------------------------------------------

const VALID_SOCIAL_TYPES = ["oidc", "oauth2"] as const;
const VALID_AUTO_LINK = ["email_match", "never"] as const;

export async function runAuthConfigSocialAdd(
  _config: IxConfig,
  id: string,
  opts: {
    displayName: string;
    type: string;
    clientId: string;
    issuer?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    userinfoUrl?: string;
    scopes?: string;
    autoLink?: string;
    rolloutTimeout?: number;
  },
  clientSecret: string,
): Promise<void> {
  const list = startListing("ix local auth config social add");
  list.commit();

  // FR-020-AC-5: validate type before any write
  if (
    !VALID_SOCIAL_TYPES.includes(
      opts.type as (typeof VALID_SOCIAL_TYPES)[number],
    )
  ) {
    const msg = `Invalid --type '${opts.type}'. Valid values: ${VALID_SOCIAL_TYPES.join(", ")}`;
    list.error(msg);
    throw new Error(msg);
  }

  // Validate auto-link if provided
  if (
    opts.autoLink &&
    !VALID_AUTO_LINK.includes(opts.autoLink as (typeof VALID_AUTO_LINK)[number])
  ) {
    const msg = `Invalid --auto-link '${opts.autoLink}'. Valid values: ${VALID_AUTO_LINK.join(", ")}`;
    list.error(msg);
    throw new Error(msg);
  }

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  const prefix = `social.${id}`;
  cmData[`${prefix}.display_name`] = opts.displayName;
  cmData[`${prefix}.type`] = opts.type;
  cmData[`${prefix}.client_id`] = opts.clientId;
  cmData[`${prefix}.client_secret_ref`] = `${prefix}.client_secret`;

  if (opts.issuer) cmData[`${prefix}.issuer`] = opts.issuer;
  if (opts.authorizeUrl) cmData[`${prefix}.authorize_url`] = opts.authorizeUrl;
  if (opts.tokenUrl) cmData[`${prefix}.token_url`] = opts.tokenUrl;
  if (opts.userinfoUrl) cmData[`${prefix}.userinfo_url`] = opts.userinfoUrl;
  if (opts.scopes) cmData[`${prefix}.scopes`] = opts.scopes;
  if (opts.autoLink) cmData[`${prefix}.auto_link`] = opts.autoLink;

  // Secret for client_secret (FR-020-CON-1)
  secretData[`${prefix}.client_secret`] = clientSecret;

  // FR-020-AC-7: auto-set social.enabled = true when provider list non-empty
  cmData["social.enabled"] = "true";

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success(`Social provider '${id}' added and identity restarted.`);
  } catch (err) {
    list.error(
      `auth config social add failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigSocialRemove(
  _config: IxConfig,
  id: string,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const list = startListing("ix local auth config social remove");
  list.commit();

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  const prefix = `social.${id}`;
  // Remove all keys for this provider
  for (const key of Object.keys(cmData)) {
    if (key.startsWith(`${prefix}.`)) delete cmData[key];
  }
  for (const key of Object.keys(secretData)) {
    if (key.startsWith(`${prefix}.`)) delete secretData[key];
  }

  // FR-020-AC-7: disable social if no providers remain
  const hasProviders = Object.keys(cmData).some(
    (k) => k.startsWith("social.") && k !== "social.enabled",
  );
  cmData["social.enabled"] = hasProviders ? "true" : "false";

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success(`Social provider '${id}' removed and identity restarted.`);
  } catch (err) {
    list.error(
      `auth config social remove failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigSocialList(
  _config: IxConfig,
): Promise<void> {
  const list = startListing("ix local auth config social list");
  list.commit();

  const cmData = await getConfigMap();

  // Collect unique provider IDs from keys like social.<id>.display_name
  const providerIds = new Set<string>();
  for (const key of Object.keys(cmData)) {
    const m = key.match(/^social\.([^.]+)\./);
    if (m && m[1] !== "enabled") providerIds.add(m[1]);
  }

  if (providerIds.size === 0) {
    list.success("No social providers configured.");
    return;
  }

  for (const id of providerIds) {
    const displayName = cmData[`social.${id}.display_name`] ?? id;
    const type = cmData[`social.${id}.type`] ?? "unknown";
    list.item(id, `${type} — ${displayName}`);
  }

  list.success(`${providerIds.size} social provider(s) configured.`);
}

export async function runAuthConfigSocialShow(
  _config: IxConfig,
  id: string,
): Promise<void> {
  const list = startListing("ix local auth config social show");
  list.commit();

  const cmData = await getConfigMap();

  const prefix = `social.${id}`;
  const fields = Object.entries(cmData)
    .filter(([k]) => k.startsWith(`${prefix}.`))
    .map(([k, v]) => {
      const shortKey = k.slice(prefix.length + 1);
      // FR-020-AC-3: NEVER print client_secret
      if (shortKey === "client_secret" || shortKey === "client_secret_ref") {
        return `  ${shortKey}: ***`;
      }
      return `  ${shortKey}: ${v}`;
    });

  if (fields.length === 0) {
    list.warn(`No social provider with id '${id}' found.`);
    return;
  }

  list.note(`Social provider '${id}':`);
  for (const f of fields) list.note(f);
  list.success(`Provider ${id}`);
}

// ---------------------------------------------------------------------------
// auth config registration
// ---------------------------------------------------------------------------

const VALID_REGISTRATION_MODES = [
  "closed",
  "invite_only",
  "admin_approved",
  "self_service",
] as const;
type RegistrationMode = (typeof VALID_REGISTRATION_MODES)[number];

export async function runAuthConfigRegistrationSet(
  _config: IxConfig,
  mode: string,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const list = startListing("ix local auth config registration set");
  list.commit();

  if (!VALID_REGISTRATION_MODES.includes(mode as RegistrationMode)) {
    const msg = `Invalid mode '${mode}'. Valid values: ${VALID_REGISTRATION_MODES.join(", ")}`;
    list.error(msg);
    throw new Error(msg);
  }

  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  const [cmData, secretData] = await Promise.all([
    getConfigMap(),
    getSecretData(),
  ]);

  cmData["registration.mode"] = mode;

  const tasks = makeMutationListr(cmData, secretData, rolloutTimeoutSeconds);

  try {
    await tasks.run();
    list.success(`Registration mode set to '${mode}' and identity restarted.`);
  } catch (err) {
    list.error(
      `auth config registration set failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function runAuthConfigRegistrationShow(
  _config: IxConfig,
): Promise<void> {
  const list = startListing("ix local auth config registration show");
  list.commit();

  const cmData = await getConfigMap();

  list.success(
    `registration.mode: ${cmData["registration.mode"] ?? "(not set)"}`,
  );
}

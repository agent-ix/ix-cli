/**
 * FR-020 — auth config Subcommands
 * Manages identity configuration (email, password-reset, social, registration)
 * by updating ConfigMap ix-system/identity-config and Secret ix-system/identity-secrets,
 * then rolling out identity deployment.
 */

import { execa } from "execa";
import type { IxConfig } from "../config.js";
import { IX_AUTH_NAMESPACE } from "./auth-identity.js";
import { buildSecretManifest as buildContractSecretManifest } from "../local-secrets.js";
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
  return buildContractSecretManifest({
    type: "opaque",
    name: "identity-secrets",
    namespace: IX_AUTH_NAMESPACE,
    keys: Object.entries(data).map(([secretKey, value]) => ({
      secretKey,
      value,
    })),
  });
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

/** Env var name under which the SMTP password is stored in the Secret. */
const EMAIL_SMTP_PASSWORD_VAR = "IDENTITY_EMAIL_SMTP_PASSWORD";

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

  // Remove legacy dotted keys (silently dropped by envFrom)
  for (const k of [
    "email.enabled",
    "email.smtp_host",
    "email.smtp_port",
    "email.smtp_user",
    "email.from",
    "email.starttls",
  ])
    delete cmData[k];
  delete secretData["email.smtp_password"];

  cmData["IDENTITY_EMAIL_ENABLED"] = "true";
  cmData["IDENTITY_EMAIL_SMTP_HOST"] = opts.smtpHost;
  cmData["IDENTITY_EMAIL_SMTP_PORT"] = String(opts.smtpPort);
  cmData["IDENTITY_EMAIL_SMTP_USERNAME"] = opts.smtpUser;
  cmData["IDENTITY_EMAIL_FROM_ADDRESS"] = opts.from;
  cmData["IDENTITY_EMAIL_SMTP_STARTTLS"] = opts.noStarttls ? "false" : "true";
  // Tell identity which env var holds the SMTP password (FR-020-CON-1)
  cmData["IDENTITY_EMAIL_SMTP_PASSWORD_REF"] = EMAIL_SMTP_PASSWORD_VAR;

  secretData[EMAIL_SMTP_PASSWORD_VAR] = smtpPassword;

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

  delete cmData["email.enabled"];
  cmData["IDENTITY_EMAIL_ENABLED"] = "false";

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
    `enabled:   ${cmData["IDENTITY_EMAIL_ENABLED"] ?? cmData["email.enabled"] ?? "false"}`,
    `smtp_host: ${cmData["IDENTITY_EMAIL_SMTP_HOST"] ?? cmData["email.smtp_host"] ?? "(not set)"}`,
    `smtp_port: ${cmData["IDENTITY_EMAIL_SMTP_PORT"] ?? cmData["email.smtp_port"] ?? "(not set)"}`,
    `smtp_user: ${cmData["IDENTITY_EMAIL_SMTP_USERNAME"] ?? cmData["email.smtp_user"] ?? "(not set)"}`,
    `from:      ${cmData["IDENTITY_EMAIL_FROM_ADDRESS"] ?? cmData["email.from"] ?? "(not set)"}`,
    `starttls:  ${cmData["IDENTITY_EMAIL_SMTP_STARTTLS"] ?? cmData["email.starttls"] ?? "(not set)"}`,
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
  const emailEnabled =
    cmData["IDENTITY_EMAIL_ENABLED"] ?? cmData["email.enabled"];
  if (mode === "email" && emailEnabled !== "true") {
    const msg =
      "password-reset=email requires email to be enabled first. Run: ix local auth config email enable ...";
    list.error(msg);
    throw new Error(msg);
  }

  delete cmData["password_reset.mode"];
  cmData["IDENTITY_PASSWORD_RESET_MODE"] = mode;

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

  const current =
    cmData["IDENTITY_PASSWORD_RESET_MODE"] ??
    cmData["password_reset.mode"] ??
    "(not set)";
  list.success(`password-reset.mode: ${current}`);
}

// ---------------------------------------------------------------------------
// auth config social
// ---------------------------------------------------------------------------

const VALID_SOCIAL_TYPES = ["oidc", "oauth2"] as const;
const VALID_AUTO_LINK = ["email_match", "never"] as const;

/** Secret key name for a provider's client secret (valid env var identifier). */
function socialSecretKey(id: string): string {
  return `IDENTITY_SOCIAL_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_CLIENT_SECRET`;
}

/** Read and parse IDENTITY_SOCIAL_PROVIDERS_JSON from the configmap. Falls
 *  back to scanning legacy dotted keys so old data is still readable. */
function readProviders(
  cmData: Record<string, string>,
): Record<string, unknown>[] {
  const raw = cmData["IDENTITY_SOCIAL_PROVIDERS_JSON"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      // fall through to legacy path
    }
  }
  // Legacy dotted-key scan
  const byId = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(cmData)) {
    const m = k.match(/^social\.([^.]+)\.(.+)$/);
    if (!m || m[1] === "enabled") continue;
    const pid = m[1];
    const field = m[2];
    if (!byId.has(pid)) byId.set(pid, { id: pid });
    byId.get(pid)![field] = v;
  }
  return Array.from(byId.values());
}

/** Remove all legacy dotted social keys from a configmap data object. */
function purgeLegacySocialKeys(cmData: Record<string, string>): void {
  for (const k of Object.keys(cmData)) {
    if (/^social\.[^.]+\./.test(k)) delete cmData[k];
  }
  delete cmData["social.enabled"];
}

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

  const secretKey = socialSecretKey(id);
  const provider: Record<string, unknown> = {
    id,
    display_name: opts.displayName,
    type: opts.type,
    client_id: opts.clientId,
    client_secret_ref: secretKey,
  };
  if (opts.issuer) provider["issuer"] = opts.issuer;
  if (opts.authorizeUrl) provider["authorize_url"] = opts.authorizeUrl;
  if (opts.tokenUrl) provider["token_url"] = opts.tokenUrl;
  if (opts.userinfoUrl) provider["userinfo_url"] = opts.userinfoUrl;
  if (opts.scopes)
    provider["scopes"] = opts.scopes.split(",").map((s) => s.trim());
  if (opts.autoLink) provider["auto_link"] = opts.autoLink;

  const providers = readProviders(cmData).filter((p) => p["id"] !== id);
  providers.push(provider);

  purgeLegacySocialKeys(cmData);
  // Remove legacy secret key if renamed
  delete secretData[`social.${id}.client_secret`];

  cmData["IDENTITY_SOCIAL_PROVIDERS_JSON"] = JSON.stringify(providers);
  // FR-020-AC-7: auto-set social.enabled = true when provider list non-empty
  cmData["IDENTITY_SOCIAL_ENABLED"] = "true";

  secretData[secretKey] = clientSecret;

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

  const providers = readProviders(cmData).filter((p) => p["id"] !== id);

  purgeLegacySocialKeys(cmData);
  delete secretData[`social.${id}.client_secret`];
  delete secretData[socialSecretKey(id)];

  if (providers.length > 0) {
    cmData["IDENTITY_SOCIAL_PROVIDERS_JSON"] = JSON.stringify(providers);
    cmData["IDENTITY_SOCIAL_ENABLED"] = "true";
  } else {
    delete cmData["IDENTITY_SOCIAL_PROVIDERS_JSON"];
    // FR-020-AC-7: disable social if no providers remain
    cmData["IDENTITY_SOCIAL_ENABLED"] = "false";
  }

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
  const providers = readProviders(cmData);

  if (providers.length === 0) {
    list.success("No social providers configured.");
    return;
  }

  for (const p of providers) {
    const id = String(p["id"] ?? "?");
    const displayName = String(p["display_name"] ?? id);
    const type = String(p["type"] ?? "unknown");
    list.item(id, `${type} — ${displayName}`);
  }

  list.success(`${providers.length} social provider(s) configured.`);
}

export async function runAuthConfigSocialShow(
  _config: IxConfig,
  id: string,
): Promise<void> {
  const list = startListing("ix local auth config social show");
  list.commit();

  const cmData = await getConfigMap();
  const providers = readProviders(cmData);
  const provider = providers.find((p) => p["id"] === id);

  if (!provider) {
    list.warn(`No social provider with id '${id}' found.`);
    return;
  }

  list.note(`Social provider '${id}':`);
  for (const [k, v] of Object.entries(provider)) {
    if (k === "id") continue;
    // FR-020-AC-3: NEVER print client_secret_ref value
    if (k === "client_secret_ref") {
      list.note(`  ${k}: ***`);
    } else {
      list.note(`  ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
  }
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

  // identity reads IDENTITY_REGISTRATION_MODE from env (configmap is envFrom);
  // dotted keys never reach the service. Drop legacy key if present.
  delete cmData["registration.mode"];
  cmData["IDENTITY_REGISTRATION_MODE"] = mode;

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

  const current =
    cmData["IDENTITY_REGISTRATION_MODE"] ??
    cmData["registration.mode"] ??
    "(not set)";
  list.success(`registration.mode: ${current}`);
}

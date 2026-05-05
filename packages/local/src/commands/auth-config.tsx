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
import { Item, Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

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
 * Apply ConfigMap+Secret then rollout identity.
 */
async function applyAndRolloutIdentity(
  cmData: Record<string, string>,
  secretData: Record<string, string>,
  rolloutTimeoutSeconds: number,
): Promise<void> {
  await ensureIdentityDeploymentExists();
  await applyManifest(buildConfigMapManifest(cmData));
  await applyManifest(buildSecretManifest(secretData));
  await rolloutIdentity(rolloutTimeoutSeconds);
}

async function renderFailure(header: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await renderStatic(
    <Listing
      header={header}
      status="failed"
      tail={`Failed: ${msg}`}
      tailVariant="error"
    />,
  );
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
  const header = "ix local auth config email enable";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
    const [cmData, secretData] = await Promise.all([
      getConfigMap(),
      getSecretData(),
    ]);

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
    cmData["IDENTITY_EMAIL_SMTP_PASSWORD_REF"] = EMAIL_SMTP_PASSWORD_VAR;

    secretData[EMAIL_SMTP_PASSWORD_VAR] = smtpPassword;

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail="Email configuration enabled and identity restarted."
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigEmailDisable(
  _config: IxConfig,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const header = "ix local auth config email disable";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
    const [cmData, secretData] = await Promise.all([
      getConfigMap(),
      getSecretData(),
    ]);

    delete cmData["email.enabled"];
    cmData["IDENTITY_EMAIL_ENABLED"] = "false";

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail="Email configuration disabled and identity restarted."
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigEmailShow(_config: IxConfig): Promise<void> {
  const header = "ix local auth config email show";
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

  await renderStatic(
    <Listing header={header} status="passed" tail="email configuration">
      {lines.map((line, i) => (
        <Note key={i}>{line}</Note>
      ))}
    </Listing>,
  );
}

export async function runAuthConfigEmailTest(
  _config: IxConfig,
  to: string,
): Promise<void> {
  const header = "ix local auth config email test";
  try {
    await ensureIdentityDeploymentExists();
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
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Test email sent to ${to}.`}
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
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
  const header = "ix local auth config password-reset set";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
    if (!VALID_PR_MODES.includes(mode as PasswordResetMode)) {
      throw new Error(
        `Invalid mode '${mode}'. Valid values: ${VALID_PR_MODES.join(", ")}`,
      );
    }

    const [cmData, secretData] = await Promise.all([
      getConfigMap(),
      getSecretData(),
    ]);

    // FR-020-AC-6: email mode requires email to be enabled first
    const emailEnabled =
      cmData["IDENTITY_EMAIL_ENABLED"] ?? cmData["email.enabled"];
    if (mode === "email" && emailEnabled !== "true") {
      throw new Error(
        "password-reset=email requires email to be enabled first. Run: ix local auth config email enable ...",
      );
    }

    delete cmData["password_reset.mode"];
    cmData["IDENTITY_PASSWORD_RESET_MODE"] = mode;

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Password reset mode set to '${mode}' and identity restarted.`}
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigPasswordResetShow(
  _config: IxConfig,
): Promise<void> {
  const header = "ix local auth config password-reset show";
  const cmData = await getConfigMap();

  const current =
    cmData["IDENTITY_PASSWORD_RESET_MODE"] ??
    cmData["password_reset.mode"] ??
    "(not set)";
  await renderStatic(
    <Listing
      header={header}
      status="passed"
      tail={`password-reset.mode: ${current}`}
    />,
  );
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
  const header = "ix local auth config social add";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
    if (
      !VALID_SOCIAL_TYPES.includes(
        opts.type as (typeof VALID_SOCIAL_TYPES)[number],
      )
    ) {
      throw new Error(
        `Invalid --type '${opts.type}'. Valid values: ${VALID_SOCIAL_TYPES.join(", ")}`,
      );
    }
    if (
      opts.autoLink &&
      !VALID_AUTO_LINK.includes(
        opts.autoLink as (typeof VALID_AUTO_LINK)[number],
      )
    ) {
      throw new Error(
        `Invalid --auto-link '${opts.autoLink}'. Valid values: ${VALID_AUTO_LINK.join(", ")}`,
      );
    }

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
    delete secretData[`social.${id}.client_secret`];

    cmData["IDENTITY_SOCIAL_PROVIDERS_JSON"] = JSON.stringify(providers);
    // FR-020-AC-7
    cmData["IDENTITY_SOCIAL_ENABLED"] = "true";

    secretData[secretKey] = clientSecret;

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Social provider '${id}' added and identity restarted.`}
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigSocialRemove(
  _config: IxConfig,
  id: string,
  opts: { rolloutTimeout?: number },
): Promise<void> {
  const header = "ix local auth config social remove";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
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
      cmData["IDENTITY_SOCIAL_ENABLED"] = "false";
    }

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Social provider '${id}' removed and identity restarted.`}
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigSocialList(
  _config: IxConfig,
): Promise<void> {
  const header = "ix local auth config social list";
  const cmData = await getConfigMap();
  const providers = readProviders(cmData);

  if (providers.length === 0) {
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail="No social providers configured."
      />,
    );
    return;
  }

  await renderStatic(
    <Listing
      header={header}
      status="passed"
      tail={`${providers.length} social provider(s) configured.`}
    >
      {providers.map((p) => {
        const id = String(p["id"] ?? "?");
        const displayName = String(p["display_name"] ?? id);
        const type = String(p["type"] ?? "unknown");
        return (
          <Item key={id} name={id} description={`${type} — ${displayName}`} />
        );
      })}
    </Listing>,
  );
}

export async function runAuthConfigSocialShow(
  _config: IxConfig,
  id: string,
): Promise<void> {
  const header = "ix local auth config social show";
  const cmData = await getConfigMap();
  const providers = readProviders(cmData);
  const provider = providers.find((p) => p["id"] === id);

  if (!provider) {
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`No social provider with id '${id}' found.`}
        tailVariant="warn"
      />,
    );
    return;
  }

  const lines: string[] = [`Social provider '${id}':`];
  for (const [k, v] of Object.entries(provider)) {
    if (k === "id") continue;
    // FR-020-AC-3: NEVER print client_secret_ref value
    if (k === "client_secret_ref") {
      lines.push(`  ${k}: ***`);
    } else {
      lines.push(`  ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
  }
  await renderStatic(
    <Listing header={header} status="passed" tail={`Provider ${id}`}>
      {lines.map((line, i) => (
        <Note key={i}>{line}</Note>
      ))}
    </Listing>,
  );
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
  const header = "ix local auth config registration set";
  const rolloutTimeoutSeconds = opts.rolloutTimeout ?? 120;

  try {
    if (!VALID_REGISTRATION_MODES.includes(mode as RegistrationMode)) {
      throw new Error(
        `Invalid mode '${mode}'. Valid values: ${VALID_REGISTRATION_MODES.join(", ")}`,
      );
    }

    const [cmData, secretData] = await Promise.all([
      getConfigMap(),
      getSecretData(),
    ]);

    delete cmData["registration.mode"];
    cmData["IDENTITY_REGISTRATION_MODE"] = mode;

    await applyAndRolloutIdentity(cmData, secretData, rolloutTimeoutSeconds);

    await renderStatic(
      <Listing
        header={header}
        status="passed"
        tail={`Registration mode set to '${mode}' and identity restarted.`}
      />,
    );
  } catch (err) {
    await renderFailure(header, err);
    throw err;
  }
}

export async function runAuthConfigRegistrationShow(
  _config: IxConfig,
): Promise<void> {
  const header = "ix local auth config registration show";
  const cmData = await getConfigMap();

  const current =
    cmData["IDENTITY_REGISTRATION_MODE"] ??
    cmData["registration.mode"] ??
    "(not set)";
  await renderStatic(
    <Listing
      header={header}
      status="passed"
      tail={`registration.mode: ${current}`}
    />,
  );
}

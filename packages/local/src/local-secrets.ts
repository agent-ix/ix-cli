import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { password, isCancel } from "@agent-ix/ix-ui-cli";
import { parse as parseYaml } from "yaml";

export const SECRETS_FILENAME = "ix-local.secrets.yaml";

interface SecretKeySpec {
  secretKey?: unknown;
  env?: unknown;
  prompt?: unknown;
  required?: unknown;
  generate?: unknown;
}

interface RegistrySpec {
  host?: unknown;
  username?: unknown;
  passwordEnv?: unknown;
  required?: unknown;
}

interface SecretSpec {
  name?: unknown;
  namespace?: unknown;
  type?: unknown;
  keys?: unknown;
  registries?: unknown;
}

interface SecretsFile {
  secrets?: unknown;
}

export interface ResolvedSecretKey {
  secretKey: string;
  value: string;
}

export interface ResolvedRegistry {
  host: string;
  username: string;
  password: string;
}

export type ResolvedSecret =
  | {
      type: "opaque";
      name: string;
      namespace: string;
      keys: ResolvedSecretKey[];
    }
  | {
      type: "dockerconfigjson";
      name: string;
      namespace: string;
      registries: ResolvedRegistry[];
    };

export interface SecretContract {
  repoDir: string;
  secrets: ResolvedSecret[];
}

function readSecretsFile(repoDir: string): SecretsFile | null {
  const filePath = path.join(repoDir, SECRETS_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return (parseYaml(fs.readFileSync(filePath, "utf-8")) as SecretsFile) ?? null;
}

/**
 * Locate the directory that owns a service's ix-local.secrets.yaml.
 *
 * Two layouts are supported:
 *   1. Single-service repo at `<devDir>/<name>/ix-local.secrets.yaml`.
 *   2. Multi-chart repo with the file at
 *      `<devDir>/<repo>/helm/<name>/ix-local.secrets.yaml` (e.g.
 *      ix-local-build hosting npm-proxy and pypi-proxy).
 *
 * Returns null if no contract file is found.
 */
export function findSecretContractDir(
  name: string,
  devDir: string,
): string | null {
  const direct = path.join(devDir, name);
  if (fs.existsSync(path.join(direct, SECRETS_FILENAME))) return direct;

  if (!fs.existsSync(devDir)) return null;
  for (const entry of fs.readdirSync(devDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === name) continue;
    const candidate = path.join(devDir, entry.name, "helm", name);
    if (fs.existsSync(path.join(candidate, SECRETS_FILENAME))) return candidate;
  }
  return null;
}

function parseGenerateSpec(raw: unknown): "randomHex32" | "uuidV4" | null {
  return raw === "randomHex32" || raw === "uuidV4" ? raw : null;
}

function generateSecretValue(generator: "randomHex32" | "uuidV4"): string {
  if (generator === "randomHex32") {
    return crypto.randomBytes(32).toString("hex");
  }
  if (generator === "uuidV4") {
    return crypto.randomUUID();
  }
  throw new Error(`Unsupported secret generator: ${generator satisfies never}`);
}

function parseEnvNames(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim() !== "") {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readEnvFirstHit(envNames: string[]): string | null {
  for (const envName of envNames) {
    const v = process.env[envName]?.trim();
    if (v) return v;
  }
  return null;
}

async function resolveSecretKey(
  repoDir: string,
  secretName: string,
  raw: SecretKeySpec,
): Promise<ResolvedSecretKey> {
  if (typeof raw.secretKey !== "string" || raw.secretKey.trim() === "") {
    throw new Error(
      `Invalid secret key declaration in ${repoDir}/${SECRETS_FILENAME} for secret '${secretName}'`,
    );
  }

  const envNames = parseEnvNames(raw.env);
  const envValue = readEnvFirstHit(envNames);
  if (envValue) {
    return { secretKey: raw.secretKey, value: envValue };
  }

  const generator = parseGenerateSpec(raw.generate);
  if (generator) {
    return {
      secretKey: raw.secretKey,
      value: generateSecretValue(generator),
    };
  }

  const required = raw.required !== false;
  if (!required) {
    return { secretKey: raw.secretKey, value: "" };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `Missing required secret '${raw.secretKey}' for '${secretName}'. Set ${envNames.join(", ") || "an env var"} or run in an interactive terminal.`,
    );
  }

  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim() !== ""
      ? raw.prompt
      : `Enter value for ${raw.secretKey}`;
  const value = await password({ message: prompt, mask: "*" });
  if (isCancel(value)) {
    throw new Error("Secret prompt cancelled");
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error(`No value provided for required secret '${raw.secretKey}'`);
  }
  return { secretKey: raw.secretKey, value: trimmed };
}

function resolveRegistry(
  repoDir: string,
  secretName: string,
  raw: RegistrySpec,
): ResolvedRegistry | null {
  if (typeof raw.host !== "string" || raw.host.trim() === "") {
    throw new Error(
      `Invalid registry host in ${repoDir}/${SECRETS_FILENAME} for secret '${secretName}'`,
    );
  }
  const username =
    typeof raw.username === "string" && raw.username.trim() !== ""
      ? raw.username
      : "_token";
  const envNames = parseEnvNames(raw.passwordEnv);
  if (envNames.length === 0) {
    throw new Error(
      `Registry '${raw.host}' in '${secretName}' must declare passwordEnv (one or more env var names)`,
    );
  }
  const password = readEnvFirstHit(envNames);
  if (!password) {
    if (raw.required === false) return null;
    throw new Error(
      `Missing password for registry '${raw.host}' in secret '${secretName}'. Set one of: ${envNames.join(", ")}`,
    );
  }
  return { host: raw.host, username, password };
}

function parseSecretType(raw: unknown): "opaque" | "dockerconfigjson" {
  if (raw === undefined || raw === null) return "opaque";
  if (raw === "opaque" || raw === "Opaque") return "opaque";
  if (raw === "dockerconfigjson") return "dockerconfigjson";
  throw new Error(
    `Unsupported secret type '${String(raw)}'. Supported: opaque, dockerconfigjson`,
  );
}

export async function loadSecretContract(
  repoDir: string,
): Promise<SecretContract | null> {
  const parsed = readSecretsFile(repoDir);
  if (!parsed) return null;

  const secretsRaw = Array.isArray(parsed.secrets) ? parsed.secrets : [];
  const secrets: ResolvedSecret[] = [];
  for (const rawSecret of secretsRaw) {
    const secret = rawSecret as SecretSpec;
    if (typeof secret.name !== "string" || secret.name.trim() === "") {
      throw new Error(`Invalid secret name in ${repoDir}/${SECRETS_FILENAME}`);
    }
    const namespace =
      typeof secret.namespace === "string" && secret.namespace.trim() !== ""
        ? secret.namespace
        : "default";
    const type = parseSecretType(secret.type);

    if (type === "dockerconfigjson") {
      const registriesRaw = Array.isArray(secret.registries)
        ? secret.registries
        : [];
      if (registriesRaw.length === 0) {
        throw new Error(
          `Secret '${secret.name}' (type: dockerconfigjson) must declare at least one registry`,
        );
      }
      const registries: ResolvedRegistry[] = [];
      for (const rawReg of registriesRaw) {
        const reg = resolveRegistry(
          repoDir,
          secret.name,
          rawReg as RegistrySpec,
        );
        if (reg) registries.push(reg);
      }
      secrets.push({
        type: "dockerconfigjson",
        name: secret.name,
        namespace,
        registries,
      });
      continue;
    }

    const keysRaw = Array.isArray(secret.keys) ? secret.keys : [];
    const keys: ResolvedSecretKey[] = [];
    for (const rawKey of keysRaw) {
      const resolved = await resolveSecretKey(
        repoDir,
        secret.name,
        rawKey as SecretKeySpec,
      );
      if (resolved.value !== "") {
        keys.push(resolved);
      }
    }
    secrets.push({ type: "opaque", name: secret.name, namespace, keys });
  }

  return { repoDir, secrets };
}

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function buildOpaqueManifest(secret: {
  name: string;
  namespace: string;
  keys: ResolvedSecretKey[];
}): string {
  const lines = [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    `  name: ${secret.name}`,
    `  namespace: ${secret.namespace}`,
    "type: Opaque",
    "data:",
  ];
  for (const key of secret.keys) {
    lines.push(`  ${key.secretKey}: ${b64(key.value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildDockerconfigjsonManifest(secret: {
  name: string;
  namespace: string;
  registries: ResolvedRegistry[];
}): string {
  const auths: Record<
    string,
    { username: string; password: string; auth: string }
  > = {};
  for (const reg of secret.registries) {
    auths[reg.host] = {
      username: reg.username,
      password: reg.password,
      auth: b64(`${reg.username}:${reg.password}`),
    };
  }
  const dockerconfig = JSON.stringify({ auths });
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    `  name: ${secret.name}`,
    `  namespace: ${secret.namespace}`,
    "type: kubernetes.io/dockerconfigjson",
    "data:",
    `  .dockerconfigjson: ${b64(dockerconfig)}`,
    "",
  ].join("\n");
}

/**
 * Build the kubectl-apply input for a single resolved secret. Exported so
 * other ix-cli paths (init-cluster bootstrap, auth-config, etc.) can produce
 * Secret YAML through the one canonical builder.
 */
export function buildSecretManifest(secret: ResolvedSecret): string {
  if (secret.type === "dockerconfigjson") {
    return buildDockerconfigjsonManifest(secret);
  }
  return buildOpaqueManifest(secret);
}

function isEmpty(secret: ResolvedSecret): boolean {
  if (secret.type === "dockerconfigjson") return secret.registries.length === 0;
  return secret.keys.length === 0;
}

export async function applySecretContract(
  contract: SecretContract,
  namespace: string,
  onOutput?: (line: string) => void,
): Promise<void> {
  for (const secret of contract.secrets) {
    if (isEmpty(secret)) continue;
    const manifest = buildSecretManifest({ ...secret, namespace });
    const subprocess = execa("kubectl", ["apply", "-f", "-"], {
      input: manifest,
      all: true,
    });
    subprocess.all?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) onOutput?.(line);
    });
    await subprocess;
  }
}

/**
 * FR-032: Ensure `ghcr-creds` (kubernetes.io/dockerconfigjson) exists in the
 * target namespace so the kubelet can pull images from ghcr.io. Idempotent
 * via `kubectl apply` — safe to call before every install.
 *
 * Sources the GHCR token via the same `resolveGhcrToken` chain used for
 * `helm registry login`. Username defaults to `_token` (the GHCR PAT
 * convention; the username field is not validated by ghcr.io for PATs).
 */
export async function ensureGhcrCredsInNamespace(
  namespace: string,
  token: string,
  username: string = "_token",
): Promise<void> {
  const auth = Buffer.from(`${username}:${token}`).toString("base64");
  const dockerconfig = JSON.stringify({
    auths: {
      "ghcr.io": {
        username,
        password: token,
        email: "ix@ix.local",
        auth,
      },
    },
  });
  const dockerconfigB64 = Buffer.from(dockerconfig).toString("base64");
  const manifest = [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: ghcr-creds",
    `  namespace: ${namespace}`,
    "type: kubernetes.io/dockerconfigjson",
    "data:",
    `  .dockerconfigjson: ${dockerconfigB64}`,
    "",
  ].join("\n");
  await execa("kubectl", ["apply", "-f", "-"], { input: manifest });
}

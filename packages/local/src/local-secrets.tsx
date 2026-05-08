import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type React from "react";
import { execa } from "execa";
import {
  PasswordPrompt,
  render,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";
import { parse as parseYaml } from "yaml";

async function promptForSecret(message: string): Promise<string | null> {
  let captured: string | null = null;
  let cancelled = false;
  const Capture: React.FC = () => {
    const { exit } = useRenderResult();
    const [done, setDone] = useState(false);
    useEffect(() => {
      if (done) {
        const t = setTimeout(exit, 0);
        return () => clearTimeout(t);
      }
    }, [done, exit]);
    return (
      <PasswordPrompt
        message={message}
        onSubmit={(r) => {
          if (r.ok) captured = r.value;
          else cancelled = true;
          setDone(true);
        }}
      />
    );
  };
  await render(<Capture />);
  return cancelled ? null : captured;
}

export const SECRETS_FILENAME = "ix-local.secrets.yaml";

interface SecretKeySpec {
  secretKey?: unknown;
  env?: unknown;
  prompt?: unknown;
  required?: unknown;
  generate?: unknown;
  valueFrom?: unknown;
}

interface SecretKeyRefSpec {
  namespace?: unknown;
  name?: unknown;
  key?: unknown;
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
  generated?: boolean;
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

function parseSecretKeyRef(
  raw: unknown,
  secretKey: string,
  secretName: string,
  repoDir: string,
): { namespace: string; name: string; key: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") {
    throw new Error(
      `Invalid valueFrom for key '${secretKey}' in '${secretName}' (${repoDir}/${SECRETS_FILENAME}): must be an object`,
    );
  }
  const vf = raw as { secretKeyRef?: unknown };
  if (vf.secretKeyRef === undefined) return null;
  if (typeof vf.secretKeyRef !== "object" || vf.secretKeyRef === null) {
    throw new Error(
      `Invalid valueFrom.secretKeyRef for key '${secretKey}' in '${secretName}' (${repoDir}/${SECRETS_FILENAME}): must be an object with namespace, name, key`,
    );
  }
  const ref = vf.secretKeyRef as SecretKeyRefSpec;
  const fieldNames = ["namespace", "name", "key"] as const;
  for (const field of fieldNames) {
    if (typeof ref[field] !== "string" || (ref[field] as string).trim() === "") {
      throw new Error(
        `valueFrom.secretKeyRef.${field} is required for key '${secretKey}' in '${secretName}' (${repoDir}/${SECRETS_FILENAME})`,
      );
    }
  }
  return {
    namespace: (ref.namespace as string).trim(),
    name: (ref.name as string).trim(),
    key: (ref.key as string).trim(),
  };
}

async function readClusterSecretValue(
  ref: { namespace: string; name: string; key: string },
): Promise<string | null> {
  const result = await execa(
    "kubectl",
    [
      "get",
      "secret",
      "-n",
      ref.namespace,
      ref.name,
      "-o",
      `jsonpath={.data.${ref.key}}`,
    ],
    { reject: false },
  );
  if (result.exitCode !== 0) {
    const stderr = (result.stderr ?? "").toString();
    if (/NotFound|not found/i.test(stderr)) return null;
    throw new Error(
      `kubectl get secret ${ref.namespace}/${ref.name} failed: ${stderr.trim() || `exit ${result.exitCode}`}`,
    );
  }
  const encoded = (result.stdout ?? "").toString().trim();
  if (!encoded) return null;
  return Buffer.from(encoded, "base64").toString("utf-8");
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

  const ref = parseSecretKeyRef(
    raw.valueFrom,
    raw.secretKey,
    secretName,
    repoDir,
  );
  if (ref) {
    const value = await readClusterSecretValue(ref);
    if (value === null || value === "") {
      throw new Error(
        `Source secret ${ref.namespace}/${ref.name} (key '${ref.key}') for '${raw.secretKey}' in '${secretName}' not found. Bring up the owning service first.`,
      );
    }
    return { secretKey: raw.secretKey, value };
  }

  const generator = parseGenerateSpec(raw.generate);
  if (generator) {
    return {
      secretKey: raw.secretKey,
      value: generateSecretValue(generator),
      generated: true,
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
  const value = await promptForSecret(prompt);
  if (value === null) {
    throw new Error("Secret prompt cancelled");
  }
  const trimmed = value.trim();
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

function decodeB64(s: string): string {
  return Buffer.from(s, "base64").toString("utf-8");
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

async function readExistingSecretData(
  name: string,
  namespace: string,
): Promise<Record<string, string> | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "secret",
      name,
      "-n",
      namespace,
      "-o",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as { data?: Record<string, string> };
    return parsed.data ?? {};
  } catch (err) {
    const e = err as { stderr?: string; all?: string; message?: string };
    const msg = e.all ?? e.stderr ?? e.message ?? String(err);
    if (/notfound|not found/i.test(msg)) return null;
    throw err;
  }
}

async function preserveGeneratedValues(
  secret: Extract<ResolvedSecret, { type: "opaque" }>,
  namespace: string,
): Promise<Extract<ResolvedSecret, { type: "opaque" }>> {
  if (!secret.keys.some((key) => key.generated)) {
    return { ...secret, namespace };
  }
  const existingData = await readExistingSecretData(secret.name, namespace);
  if (!existingData) return { ...secret, namespace };
  return {
    ...secret,
    namespace,
    keys: secret.keys.map((key) => {
      if (!key.generated) return key;
      const existing = existingData[key.secretKey];
      return existing ? { ...key, value: decodeB64(existing) } : key;
    }),
  };
}

async function prepareSecretForApply(
  secret: ResolvedSecret,
  namespace: string,
): Promise<ResolvedSecret> {
  if (secret.type === "dockerconfigjson") return { ...secret, namespace };
  return preserveGeneratedValues(secret, namespace);
}

export async function applySecretContract(
  contract: SecretContract,
  namespace: string,
  onOutput?: (line: string) => void,
): Promise<void> {
  for (const secret of contract.secrets) {
    if (isEmpty(secret)) continue;
    const manifest = buildSecretManifest(
      await prepareSecretForApply(secret, namespace),
    );
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
 * FR-033: Extract a chart tgz and load its secret contract, if present.
 * Returns null when the chart contains no ix-local.secrets.yaml.
 * The temporary extraction directory is always deleted in a finally block.
 */
export async function loadSecretContractFromTgz(
  tgzPath: string,
  chartName: string,
): Promise<SecretContract | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ix-secrets-extract-"));
  try {
    await execa("tar", ["-xzf", tgzPath, "-C", tmpDir]);
    return await loadSecretContract(path.join(tmpDir, chartName));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

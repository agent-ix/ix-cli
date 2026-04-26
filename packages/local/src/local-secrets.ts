import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import * as p from "@clack/prompts";
import { parse as parseYaml } from "yaml";

export const SECRETS_FILENAME = "ix-local.secrets.yaml";

interface SecretKeySpec {
  secretKey?: unknown;
  env?: unknown;
  prompt?: unknown;
  required?: unknown;
  generate?: unknown;
}

interface SecretSpec {
  name?: unknown;
  namespace?: unknown;
  keys?: unknown;
}

interface SecretsFile {
  secrets?: unknown;
}

export interface ResolvedSecretKey {
  secretKey: string;
  value: string;
}

export interface ResolvedSecret {
  name: string;
  namespace: string;
  keys: ResolvedSecretKey[];
}

export interface SecretContract {
  repoDir: string;
  secrets: ResolvedSecret[];
}

function readSecretsFile(repoDir: string): SecretsFile | null {
  const filePath = path.join(repoDir, SECRETS_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return (parseYaml(fs.readFileSync(filePath, "utf-8")) as SecretsFile) ?? null;
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
  for (const envName of envNames) {
    const envValue = process.env[envName]?.trim();
    if (envValue) {
      return { secretKey: raw.secretKey, value: envValue };
    }
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
  const value = await p.password({ message: prompt, mask: "*" });
  if (p.isCancel(value)) {
    throw new Error("Secret prompt cancelled");
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error(`No value provided for required secret '${raw.secretKey}'`);
  }
  return { secretKey: raw.secretKey, value: trimmed };
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
    secrets.push({
      name: secret.name,
      namespace:
        typeof secret.namespace === "string" && secret.namespace.trim() !== ""
          ? secret.namespace
          : "default",
      keys,
    });
  }

  return { repoDir, secrets };
}

function buildSecretManifest(secret: ResolvedSecret): string {
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
    lines.push(
      `  ${key.secretKey}: ${Buffer.from(key.value).toString("base64")}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function applySecretContract(
  contract: SecretContract,
  onOutput?: (line: string) => void,
): Promise<void> {
  for (const secret of contract.secrets) {
    if (secret.keys.length === 0) continue;
    const subprocess = execa("kubectl", ["apply", "-f", "-"], {
      input: buildSecretManifest(secret),
      all: true,
    });
    subprocess.all?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) onOutput?.(line);
    });
    await subprocess;
  }
}

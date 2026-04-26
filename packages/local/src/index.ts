import { Command } from "commander";
import { createRequire } from "node:module";
import { Listr } from "listr2";
import { execa } from "execa";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as p from "@clack/prompts";
import { loadConfig, type IxConfig } from "./config.js";
import { runInitCluster } from "./commands/init-cluster.js";
import { runImageModeUp } from "./commands/up-image.js";
import { runSourceModeUp } from "./commands/up-source.js";
import { runList } from "./commands/list.js";
import { loadRegistry, findDeployable } from "./registry.js";
import { resolveGhcrToken } from "./credentials.js";
import { runAuthInit } from "./commands/auth-init.js";
import { runAuthResetAdmin } from "./commands/auth-reset-admin.js";
import { runAuthInvite } from "./commands/auth-invite.js";
import { runAuthResetUser } from "./commands/auth-reset-user.js";
import {
  runAuthConfigEmailEnable,
  runAuthConfigEmailDisable,
  runAuthConfigEmailShow,
  runAuthConfigEmailTest,
  runAuthConfigPasswordResetSet,
  runAuthConfigPasswordResetShow,
  runAuthConfigSocialAdd,
  runAuthConfigSocialRemove,
  runAuthConfigSocialList,
  runAuthConfigSocialShow,
  runAuthConfigRegistrationSet,
  runAuthConfigRegistrationShow,
} from "./commands/auth-config.js";

// H4: FR-001-CON-1: DEV_DIR overridable via env (default ~/dev, not hardcoded user path)
export const DEV_DIR = process.env.IX_DEV_DIR ?? path.join(os.homedir(), "dev");

function deployableMatchesTags(
  deployable: { tags: string[] },
  opts: { includeTag?: string; excludeTag?: string },
): boolean {
  if (opts.includeTag && !deployable.tags.includes(opts.includeTag)) {
    return false;
  }
  if (opts.excludeTag && deployable.tags.includes(opts.excludeTag)) {
    return false;
  }
  return true;
}

export async function executeLocals(services: string[], action: "up" | "down") {
  p.intro(pc.bgCyan(pc.black(` ix-local ${action} `)));

  // M6: If user passes both named services and "all", that's a conflicting
  // intent — error rather than silently dropping named services.
  if (
    services.length > 1 &&
    services.some((s) => s === "all") &&
    services.some((s) => s !== "all")
  ) {
    throw new Error(
      'Cannot mix "all" with named services. Use "all" alone or list individual services.',
    );
  }

  if (services.length === 0 || services.includes("all")) {
    services = ["all"];
  }

  if (action === "up" && services.some((svc) => svc !== "all")) {
    throw new Error(
      "Named source deploys are handled by the Helm-native source-mode runner. Use runUp(..., { fromSource: true }) instead of executeLocals(..., 'up').",
    );
  }

  const tasks = new Listr(
    services.map((svc) => {
      const isGlobal = svc === "all";
      const serviceDir = isGlobal
        ? path.join(DEV_DIR, "local")
        : path.join(DEV_DIR, svc);

      const cmd = isGlobal
        ? action === "up"
          ? "up"
          : "down"
        : action === "up"
          ? "deploy"
          : "halt";

      return {
        title: `${action === "up" ? "Starting" : "Stopping"} ${pc.cyan(svc)}`,
        task: async (ctx, task) => {
          if (!fs.existsSync(serviceDir)) {
            // FR-004-AC-1: descriptive directory error
            if (!isGlobal && action === "up") {
              throw new Error(
                `Directory not found: ${serviceDir}. ` +
                  `Drop --from-source to deploy the latest stable build from the registry.`,
              );
            }
            throw new Error(`Directory not found: ${serviceDir}`);
          }

          const subprocess = execa("make", [cmd], {
            cwd: serviceDir,
            all: true,
          });

          subprocess.all?.on("data", (chunk) => {
            let logLine = chunk.toString().trim();
            if (logLine) {
              const lines = logLine.split("\n").filter(Boolean);
              if (lines.length > 0) {
                task.output = lines[lines.length - 1];
              }
            }
          });

          await subprocess;
        },
      };
    }),
    {
      concurrent: false,
      rendererOptions: {
        collapseSubtasks: false,
      },
    },
  );

  try {
    await tasks.run();
    p.outro(
      pc.green(
        `Successfully ${action === "up" ? "started" : "stopped"} everything.`,
      ),
    );
  } catch (err) {
    // FR-003-AC-3: failure outro
    p.outro(
      pc.red(`Failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    throw err;
  }
}

/**
 * FR-008: top-level dispatcher for `ix-local up`. Default = image mode from
 * registry; `--from-source` opts into local Helm chart deployment.
 *
 * Exported for unit tests that need to assert the dispatch logic without
 * routing through commander.
 */
export async function runUp(
  servicesArgs: string[],
  opts: {
    fromSource?: boolean;
    tag?: string;
    includeTag?: string;
    excludeTag?: string;
    continueOnError?: boolean;
    latest?: boolean;
  } = {},
): Promise<void> {
  const services = servicesArgs.length > 0 ? servicesArgs : ["all"];

  if (opts.fromSource) {
    if (services.includes("all")) {
      await executeLocals(services, "up");
      return;
    }
    const config = loadConfig();
    await runSourceModeUp(services, config, opts.tag ?? null, DEV_DIR, {
      includeTag: opts.includeTag,
      excludeTag: opts.excludeTag,
      continueOnError: opts.continueOnError,
    });
    return;
  }

  // FR-008-AC-6: "all" without --from-source is rejected.
  if (services.includes("all")) {
    throw new Error(
      '"all" requires --from-source. For image-mode deploys, list deployables explicitly (see `ix-local list`).',
    );
  }
  const config = loadConfig();
  const registry = await loadRegistryForCommand(config);
  for (const svc of services) {
    const deployable = findDeployable(registry, svc);
    const filteredExpander =
      deployable.role === "app"
        ? async () => {
            const { defaultExpandApp } = await import("./commands/up-image.js");
            const installs = await defaultExpandApp(deployable, config);
            return installs
              .filter((install) => {
                const child = registry.find((d) => d.name === install.name);
                if (!child) return true;
                return deployableMatchesTags(child, opts);
              })
              .map((install) => {
                if (!opts.latest) return install;
                const child = registry.find((d) => d.name === install.name);
                return child
                  ? { ...install, chartVersion: child.version }
                  : install;
              });
          }
        : undefined;
    if (deployable.role !== "app" && !deployableMatchesTags(deployable, opts)) {
      throw new Error(
        `Deployable '${deployable.name}' does not match the requested tag filters.`,
      );
    }
    await runImageModeUp(
      deployable,
      config,
      opts.tag ?? null,
      filteredExpander,
      { continueOnError: opts.continueOnError },
      DEV_DIR,
    );
  }
}

export async function runDown(
  servicesArgs: string[],
  opts: { fromSource?: boolean } = {},
): Promise<void> {
  const services = servicesArgs.length > 0 ? servicesArgs : ["all"];

  if (opts.fromSource) {
    await executeLocals(services, "down");
    return;
  }

  if (services.includes("all")) {
    throw new Error(
      '"all" requires --from-source. For image-mode teardown, list deployables explicitly (see `ix-local list`).',
    );
  }

  const config = loadConfig();
  const registry = await loadRegistryForCommand(config);
  const releases: string[] = [];
  for (const svc of services) {
    const deployable = findDeployable(registry, svc);
    if (deployable.role === "app") {
      const { defaultExpandApp } = await import("./commands/up-image.js");
      const installs = await defaultExpandApp(deployable, config);
      for (const install of installs) releases.push(install.name);
    } else {
      releases.push(deployable.name);
    }
  }

  p.intro(pc.bgCyan(pc.black(` ix-local down (image mode) `)));
  const tasks = new Listr(
    releases.map((name) => ({
      title: `Uninstall ${pc.cyan(name)}`,
      task: async (_ctx: unknown, task: { output: string }) => {
        const subprocess = execa(
          "helm",
          ["uninstall", name, "--namespace", "default", "--ignore-not-found"],
          { all: true },
        );
        subprocess.all?.on("data", (chunk) => {
          const line = chunk.toString().trim();
          if (line) task.output = line;
        });
        await subprocess;
      },
    })),
    { concurrent: false, rendererOptions: { collapseSubtasks: false } },
  );
  await tasks.run();
  p.outro(pc.green(`Uninstalled: ${releases.join(", ")}`));
}

export function buildCli() {
  const program = new Command();

  program
    .name("ix-local")
    .description(
      "CLI for managing local Agent-IX services (dev/demo/alpha/beta only).",
    )
    .version(
      (createRequire(import.meta.url)("../package.json") as { version: string })
        .version,
    );

  program
    .command("up")
    .description("Start services (global or specific)")
    .argument(
      "[services...]",
      'List of services to start, or "all" to start the cluster. Defaults to "all" if omitted.',
    )
    .option(
      "--from-source",
      "Deploy from local source via local Helm charts (source mode)",
    )
    .option("--src", "Alias for --from-source")
    .option("--tag <tag>", "Image tag override (image mode)")
    .option("--include-tag <tag>", "Only deploy children carrying this tag")
    .option("--exclude-tag <tag>", "Skip children carrying this tag")
    .option(
      "--continue-on-error",
      "Continue deploying other children when one child fails",
    )
    .option(
      "--latest",
      "Re-resolve child chart pins to latest published tags (app mode only)",
    )
    .action(
      async (
        servicesArgs: string[],
        opts: {
          fromSource?: boolean;
          src?: boolean;
          tag?: string;
          includeTag?: string;
          excludeTag?: string;
          continueOnError?: boolean;
          latest?: boolean;
        },
      ) => {
        try {
          await runUp(servicesArgs, {
            fromSource: opts.fromSource || opts.src,
            tag: opts.tag,
            includeTag: opts.includeTag,
            excludeTag: opts.excludeTag,
            continueOnError: opts.continueOnError,
            latest: opts.latest,
          });
        } catch {
          process.exit(1);
        }
      },
    );

  program
    .command("down")
    .description("Stop services (global or specific)")
    .argument(
      "[services...]",
      'List of services to stop, or "all" to stop the cluster. Defaults to "all" if omitted.',
    )
    .option("--from-source", "Tear down via local make targets (source mode)")
    .option("--src", "Alias for --from-source")
    .action(
      async (
        servicesArgs: string[],
        opts: { fromSource?: boolean; src?: boolean },
      ) => {
        try {
          await runDown(servicesArgs, {
            fromSource: opts.fromSource || opts.src,
          });
        } catch {
          process.exit(1);
        }
      },
    );

  program
    .command("list")
    .description(
      "List deployable apps and services discovered from the OCI registry.",
    )
    .option("--refresh", "Bypass the local cache and re-query the registry")
    .option("--role <role>", "Filter to 'app' or 'service'")
    .option("--category <name>", "Filter by category")
    .option("--tag <name>", "Filter to deployables carrying a tag")
    .action(
      async (opts: {
        refresh?: boolean;
        role?: "app" | "service";
        category?: string;
        tag?: string;
      }) => {
        try {
          const config = loadConfig();
          await runList(config, opts);
        } catch {
          process.exit(1);
        }
      },
    );

  program
    .command("refresh")
    .description("Force-refresh the local deployable registry cache.")
    .action(async () => {
      try {
        const config = loadConfig();
        const token =
          config.ghcrToken?.trim() || (await resolveGhcrToken(false));
        const reg = await loadRegistry({
          org: config.org,
          githubToken: token,
          refresh: true,
        });
        p.log.info(`Refreshed registry: ${reg.length} deployable(s).`);
      } catch {
        process.exit(1);
      }
    });

  program
    .command("init-cluster")
    .description(
      "Bootstrap a local kind cluster with cert-manager, wildcard TLS, and GHCR credentials (dev/demo/alpha/beta only).",
    )
    .option(
      "--reconfigure-credentials",
      "Force re-prompt for GHCR credentials even if stored",
    )
    .action(async (opts: { reconfigureCredentials?: boolean }) => {
      try {
        const config = loadConfig();
        await runInitCluster(config, opts.reconfigureCredentials ?? false);
      } catch {
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------------
  // FR-015: ix-local init — Admin Bootstrap
  // -------------------------------------------------------------------------
  program
    .command("init")
    .description(
      "Bootstrap the initial admin account in the identity service (FR-015).",
    )
    .action(async () => {
      try {
        const config = loadConfig();
        await runAuthInit(config);
      } catch {
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------------
  // auth command group (FR-016, FR-017, FR-018, FR-020)
  // -------------------------------------------------------------------------
  const auth = program
    .command("auth")
    .description("Authentication and identity management commands.");

  // FR-016: auth reset-admin
  auth
    .command("reset-admin")
    .description("Re-seed the admin temp credential (FR-016).")
    .option("--user <email>", "Target admin email when multiple admins exist")
    .option("--ttl <hours>", "Token TTL in hours (default: 1)", parseInt)
    .action(async (opts: { user?: string; ttl?: number }) => {
      try {
        const config = loadConfig();
        await runAuthResetAdmin(config, opts);
      } catch {
        process.exit(1);
      }
    });

  // FR-017: auth invite <email>
  auth
    .command("invite <email>")
    .description("Invite a new user by email (FR-017).")
    .option("--username <name>", "Username (default: derived from email)")
    .option("--display-name <name>", "Display name")
    .option("--groups <g1,g2,...>", "Comma-separated group list")
    .option(
      "--ttl <hours>",
      "Invite token TTL in hours (1-168, default: 72)",
      parseInt,
    )
    .action(
      async (
        email: string,
        opts: {
          username?: string;
          displayName?: string;
          groups?: string;
          ttl?: number;
        },
      ) => {
        try {
          const config = loadConfig();
          await runAuthInvite(config, email, opts);
        } catch {
          process.exit(1);
        }
      },
    );

  // FR-018: auth reset-user <email>
  auth
    .command("reset-user <email>")
    .description("Admin-initiated password reset for any user (FR-018).")
    .option(
      "--ttl <hours>",
      "Reset token TTL in hours (1-24, default: 1)",
      parseInt,
    )
    .action(async (email: string, opts: { ttl?: number }) => {
      try {
        const config = loadConfig();
        await runAuthResetUser(config, email, opts);
      } catch {
        process.exit(1);
      }
    });

  // FR-020: auth config subcommands
  const authConfig = auth
    .command("config")
    .description("Manage identity configuration (FR-020).");

  // auth config email
  const authConfigEmail = authConfig
    .command("email")
    .description("SMTP email configuration.");

  authConfigEmail
    .command("enable")
    .description(
      "Enable email (SMTP password read from stdin via --smtp-password-stdin).",
    )
    .requiredOption("--smtp-host <host>", "SMTP server hostname")
    .requiredOption("--smtp-port <port>", "SMTP server port", parseInt)
    .requiredOption("--smtp-user <user>", "SMTP username")
    .requiredOption("--from <address>", "From address for outgoing email")
    .option("--smtp-password-stdin", "Read SMTP password from stdin")
    .option("--no-starttls", "Disable STARTTLS")
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(
      async (opts: {
        smtpHost: string;
        smtpPort: number;
        smtpUser: string;
        from: string;
        smtpPasswordStdin?: boolean;
        starttls?: boolean;
        rolloutTimeout?: number;
      }) => {
        try {
          let password = "";
          if (opts.smtpPasswordStdin) {
            password = await readStdin();
          }
          const config = loadConfig();
          await runAuthConfigEmailEnable(
            config,
            {
              smtpHost: opts.smtpHost,
              smtpPort: opts.smtpPort,
              smtpUser: opts.smtpUser,
              from: opts.from,
              noStarttls: opts.starttls === false,
              rolloutTimeout: opts.rolloutTimeout,
            },
            password,
          );
        } catch {
          process.exit(1);
        }
      },
    );

  authConfigEmail
    .command("disable")
    .description("Disable email.")
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(async (opts: { rolloutTimeout?: number }) => {
      try {
        const config = loadConfig();
        await runAuthConfigEmailDisable(config, opts);
      } catch {
        process.exit(1);
      }
    });

  authConfigEmail
    .command("show")
    .description("Show current email config (password is never printed).")
    .action(async () => {
      try {
        const config = loadConfig();
        await runAuthConfigEmailShow(config);
      } catch {
        process.exit(1);
      }
    });

  authConfigEmail
    .command("test <to>")
    .description("Send a test email.")
    .action(async (to: string) => {
      try {
        const config = loadConfig();
        await runAuthConfigEmailTest(config, to);
      } catch {
        process.exit(1);
      }
    });

  // auth config password-reset
  const authConfigPR = authConfig
    .command("password-reset")
    .description("Password reset mode configuration.");

  authConfigPR
    .command("set <mode>")
    .description("Set password reset mode: cli_only | email | disabled.")
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(async (mode: string, opts: { rolloutTimeout?: number }) => {
      try {
        const config = loadConfig();
        await runAuthConfigPasswordResetSet(config, mode, opts);
      } catch {
        process.exit(1);
      }
    });

  authConfigPR
    .command("show")
    .description("Show current password reset mode.")
    .action(async () => {
      try {
        const config = loadConfig();
        await runAuthConfigPasswordResetShow(config);
      } catch {
        process.exit(1);
      }
    });

  // auth config social
  const authConfigSocial = authConfig
    .command("social")
    .description("Social/OAuth provider configuration.");

  authConfigSocial
    .command("add <id>")
    .description(
      "Add or update a social provider (client secret read via --client-secret-stdin).",
    )
    .requiredOption("--display-name <name>", "Provider display name")
    .requiredOption("--type <type>", "Provider type: oidc | oauth2")
    .requiredOption("--client-id <id>", "OAuth2 client ID")
    .option("--client-secret-stdin", "Read client secret from stdin")
    .option("--issuer <url>", "OIDC issuer URL")
    .option("--authorize-url <url>", "OAuth2 authorize URL")
    .option("--token-url <url>", "OAuth2 token URL")
    .option("--userinfo-url <url>", "OAuth2 userinfo URL")
    .option("--scopes <scopes>", "Comma-separated scopes")
    .option("--auto-link <mode>", "Auto-link mode: email_match | never")
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(
      async (
        id: string,
        opts: {
          displayName: string;
          type: string;
          clientId: string;
          clientSecretStdin?: boolean;
          issuer?: string;
          authorizeUrl?: string;
          tokenUrl?: string;
          userinfoUrl?: string;
          scopes?: string;
          autoLink?: string;
          rolloutTimeout?: number;
        },
      ) => {
        try {
          let clientSecret = "";
          if (opts.clientSecretStdin) {
            clientSecret = await readStdin();
          }
          const config = loadConfig();
          await runAuthConfigSocialAdd(config, id, opts, clientSecret);
        } catch {
          process.exit(1);
        }
      },
    );

  authConfigSocial
    .command("remove <id>")
    .description("Remove a social provider.")
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(async (id: string, opts: { rolloutTimeout?: number }) => {
      try {
        const config = loadConfig();
        await runAuthConfigSocialRemove(config, id, opts);
      } catch {
        process.exit(1);
      }
    });

  authConfigSocial
    .command("list")
    .description("List configured social providers.")
    .action(async () => {
      try {
        const config = loadConfig();
        await runAuthConfigSocialList(config);
      } catch {
        process.exit(1);
      }
    });

  authConfigSocial
    .command("show <id>")
    .description("Show a social provider config (client_secret never printed).")
    .action(async (id: string) => {
      try {
        const config = loadConfig();
        await runAuthConfigSocialShow(config, id);
      } catch {
        process.exit(1);
      }
    });

  // auth config registration
  const authConfigReg = authConfig
    .command("registration")
    .description("Registration mode configuration.");

  authConfigReg
    .command("set <mode>")
    .description(
      "Set registration mode: closed | invite_only | admin_approved | self_service.",
    )
    .option(
      "--rollout-timeout <seconds>",
      "Rollout timeout (default: 120)",
      parseInt,
    )
    .action(async (mode: string, opts: { rolloutTimeout?: number }) => {
      try {
        const config = loadConfig();
        await runAuthConfigRegistrationSet(config, mode, opts);
      } catch {
        process.exit(1);
      }
    });

  authConfigReg
    .command("show")
    .description("Show current registration mode.")
    .action(async () => {
      try {
        const config = loadConfig();
        await runAuthConfigRegistrationShow(config);
      } catch {
        process.exit(1);
      }
    });

  return program;
}

/** Read all stdin as a UTF-8 string (trims trailing newline). */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf-8").trimEnd()),
    );
    process.stdin.on("error", reject);
  });
}

async function loadRegistryForCommand(config: IxConfig) {
  const token = config.ghcrToken?.trim() || (await resolveGhcrToken(false));
  return loadRegistry({ org: config.org, githubToken: token });
}

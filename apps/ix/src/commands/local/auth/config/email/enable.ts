import { Command, Flags } from "@oclif/core";
import { loadConfig, runAuthConfigEmailEnable } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigEmailEnable extends Command {
  static description =
    "Enable SMTP email (password read from stdin via --smtp-password-stdin).";

  static flags = {
    "smtp-host": Flags.string({
      required: true,
      description: "SMTP server hostname.",
    }),
    "smtp-port": Flags.integer({
      required: true,
      description: "SMTP server port.",
    }),
    "smtp-user": Flags.string({
      required: true,
      description: "SMTP username.",
    }),
    from: Flags.string({
      required: true,
      description: "From address for outgoing email.",
    }),
    "smtp-password-stdin": Flags.boolean({
      description: "Read SMTP password from stdin.",
    }),
    "no-starttls": Flags.boolean({ description: "Disable STARTTLS." }),
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalAuthConfigEmailEnable);
    let smtpPassword = "";
    if (flags["smtp-password-stdin"]) {
      smtpPassword = await readStdin();
    }
    const config = loadConfig();
    try {
      await runAuthConfigEmailEnable(
        config,
        {
          smtpHost: flags["smtp-host"],
          smtpPort: flags["smtp-port"],
          smtpUser: flags["smtp-user"],
          from: flags["from"],
          noStarttls: flags["no-starttls"],
          rolloutTimeout: flags["rollout-timeout"],
        },
        smtpPassword,
      );
    } catch {
      this.exit(1);
    }
  }
}

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

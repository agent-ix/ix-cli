import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthConfigSocialAdd } from "@agent-ix/ix-cli-local";

export default class LocalAuthConfigSocialAdd extends BaseCommand {
  static description = "Add or update a social/OAuth provider.";

  static args = {
    id: Args.string({ required: true, description: "Provider ID." }),
  };

  static flags = {
    "display-name": Flags.string({
      required: true,
      description: "Provider display name.",
    }),
    type: Flags.string({
      required: true,
      description: "Provider type: oidc | oauth2.",
      options: ["oidc", "oauth2"],
    }),
    "client-id": Flags.string({
      required: true,
      description: "OAuth2 client ID.",
    }),
    "client-secret-stdin": Flags.boolean({
      description: "Read client secret from stdin.",
    }),
    issuer: Flags.string({ description: "OIDC issuer URL." }),
    "authorize-url": Flags.string({ description: "OAuth2 authorize URL." }),
    "token-url": Flags.string({ description: "OAuth2 token URL." }),
    "userinfo-url": Flags.string({ description: "OAuth2 userinfo URL." }),
    scopes: Flags.string({ description: "Comma-separated scopes." }),
    "auto-link": Flags.string({
      description: "Auto-link mode: email_match | never.",
    }),
    "rollout-timeout": Flags.integer({
      description: "Rollout timeout in seconds (default: 120).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalAuthConfigSocialAdd);
    let clientSecret = "";
    if (flags["client-secret-stdin"]) {
      clientSecret = await readStdin();
    }
    const config = loadConfig();
    try {
      await runAuthConfigSocialAdd(
        config,
        args.id,
        {
          displayName: flags["display-name"],
          type: flags.type,
          clientId: flags["client-id"],
          issuer: flags.issuer,
          authorizeUrl: flags["authorize-url"],
          tokenUrl: flags["token-url"],
          userinfoUrl: flags["userinfo-url"],
          scopes: flags.scopes,
          autoLink: flags["auto-link"],
          rolloutTimeout: flags["rollout-timeout"],
        },
        clientSecret,
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

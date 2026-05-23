import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { loadConfig, runAuthKubeconfigIssue } from "@agent-ix/ix-cli-local";

export default class LocalAuthKubeconfigIssue extends BaseCommand {
  static description =
    "Emit an operator-scoped kubeconfig backed by the ix-cli-admin ServiceAccount (FR-044).";

  static examples = [
    "ix local auth kubeconfig issue --output ~/.kube/ix-local.yaml",
  ];

  static flags = {
    output: Flags.string({
      required: true,
      char: "o",
      description: "Path to write the new kubeconfig.",
    }),
    "context-name": Flags.string({
      default: "ix-local",
      description: "current-context name in the emitted kubeconfig.",
    }),
    force: Flags.boolean({
      default: false,
      description: "Overwrite an existing file at --output.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LocalAuthKubeconfigIssue);
    const config = loadConfig();
    try {
      await runAuthKubeconfigIssue(config, {
        outputPath: flags.output,
        contextName: flags["context-name"],
        force: flags.force,
      });
    } catch {
      this.exit(1);
    }
  }
}

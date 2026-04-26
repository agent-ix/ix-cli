import { Args, Command, Flags } from "@oclif/core";
import { runUp } from "@agent-ix/ix-cli-local";

export default class LocalUp extends Command {
  static description = "Start services (image mode or source mode).";

  static args = {
    services: Args.string({
      description: 'Services to start, or "all". Defaults to "all".',
      multiple: true,
    }),
  };

  static flags = {
    "from-source": Flags.boolean({
      description: "Deploy from local Helm charts (source mode).",
    }),
    src: Flags.boolean({ description: "Alias for --from-source." }),
    tag: Flags.string({ description: "Image tag override (image mode)." }),
    "include-tag": Flags.string({
      description: "Only deploy children carrying this tag.",
    }),
    "exclude-tag": Flags.string({
      description: "Skip children carrying this tag.",
    }),
    "continue-on-error": Flags.boolean({
      description: "Continue deploying other children when one fails.",
    }),
    latest: Flags.boolean({
      description:
        "Re-resolve child chart pins to latest published tags (app mode).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalUp);
    const services = (args.services as string[] | undefined) ?? [];
    try {
      await runUp(services, {
        fromSource: flags["from-source"] || flags.src,
        tag: flags.tag,
        includeTag: flags["include-tag"],
        excludeTag: flags["exclude-tag"],
        continueOnError: flags["continue-on-error"],
        latest: flags.latest,
      });
    } catch {
      this.exit(1);
    }
  }
}

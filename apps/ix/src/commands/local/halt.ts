import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runDown } from "@agent-ix/ix-cli-local";

export default class LocalHalt extends BaseCommand {
  static description = "Stop services.";

  static args = {
    services: Args.string({
      description: 'Services to stop, or "all". Defaults to "all".',
      multiple: true,
    }),
  };

  static flags = {
    "from-source": Flags.boolean({
      description: "Tear down via local make targets (source mode).",
    }),
    src: Flags.boolean({ description: "Alias for --from-source." }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip the confirmation prompt for `halt all`.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalHalt);
    const services = (args.services as string[] | undefined) ?? [];
    try {
      await runDown(services, {
        fromSource: flags["from-source"] || flags.src,
        yes: flags.yes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error(msg, { exit: 1 });
    }
  }
}

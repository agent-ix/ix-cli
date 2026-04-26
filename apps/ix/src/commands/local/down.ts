import { Args, Command, Flags } from "@oclif/core";
import { runDown } from "@agent-ix/ix-cli-local";

export default class LocalDown extends Command {
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
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalDown);
    const services = (args.services as string[] | undefined) ?? [];
    try {
      await runDown(services, {
        fromSource: flags["from-source"] || flags.src,
      });
    } catch {
      this.exit(1);
    }
  }
}

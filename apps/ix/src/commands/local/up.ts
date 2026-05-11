import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { runTunnelExposeCommand, runUp } from "@agent-ix/ix-cli-local";

export default class LocalUp extends BaseCommand {
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
    namespace: Flags.string({
      char: "n",
      description:
        "Override the chart's declared namespace; applies to all installs in this run.",
    }),
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
    refresh: Flags.boolean({
      description:
        "Force `helm dependency update` to re-pull subchart deps from OCI even if a vendored copy exists (source mode). Helm-only; does not touch container images. Opt-in.",
    }),
    expose: Flags.boolean({
      description:
        "After install, run `ix tunnel expose <app>` to add the tunnel base domain to the app's ingress. Requires cloudflared to be running (`ix tunnel up`).",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LocalUp);
    const services = (args.services as string[] | undefined) ?? [];
    const fromSource = flags["from-source"] || flags.src;
    try {
      await runUp(services, {
        fromSource,
        tag: flags.tag,
        namespace: flags.namespace,
        includeTag: flags["include-tag"],
        excludeTag: flags["exclude-tag"],
        continueOnError: flags["continue-on-error"],
        latest: flags.latest,
        refresh: flags.refresh,
      });
      // FR-038 — convenience: opt-in tunnel exposure after a successful
      // up. Only meaningful for explicit named services (skipping
      // "all"/source-mode keeps the flag scoped to the common case).
      if (flags.expose && !fromSource) {
        const named = services.filter((s) => s !== "all");
        for (const name of named) {
          await runTunnelExposeCommand(name, null);
        }
      }
    } catch (err) {
      this.log(err instanceof Error ? err.message : String(err));
      this.exit(1);
    }
  }
}

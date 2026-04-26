import { Args, Command, Flags } from "@oclif/core";
import { runInit } from "@agent-ix/ix-cli-elements";

export default class ElementsInit extends Command {
  static description = "Scaffold a new project from an element type.";

  static args = {
    type: Args.string({
      description: "Element type (e.g. fastapi-service, python-lib).",
      required: true,
    }),
    name: Args.string({
      description: "Project name.",
      required: true,
    }),
  };

  static flags = {
    org: Flags.string({
      description: "GitHub org to create the repo under.",
      default: "agent-ix",
    }),
    "output-dir": Flags.string({
      description: "Directory to scaffold into (default: cwd).",
    }),
    "no-git": Flags.boolean({
      description: "Skip git init and initial commit.",
    }),
    "no-github": Flags.boolean({
      description: "Skip GitHub repo creation.",
    }),
    refresh: Flags.boolean({
      description: "Bypass element registry cache.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ElementsInit);
    try {
      await runInit(args.type, args.name, {
        org: flags.org,
        outputDir: flags["output-dir"],
        noGit: flags["no-git"],
        noGithub: flags["no-github"],
      });
    } catch {
      this.exit(1);
    }
  }
}

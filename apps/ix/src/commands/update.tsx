import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { spawn } from "node:child_process";
import {
  FlowLine,
  Listing,
  Note,
  blue,
  colors,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

const DEFAULT_REGISTRY = "https://npm.pkg.github.com/";

function spawnAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn(cmd, args, { shell: false });
    proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString().trim());
      else reject(new Error(`${cmd} exited with code ${String(code)}`));
    });
    proc.on("error", reject);
  });
}

function spawnInherited(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", shell: false });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${String(code)}`));
    });
    proc.on("error", reject);
  });
}

export default class Update extends BaseCommand {
  static description = "Check for and install ix CLI updates.";

  static flags = {
    check: Flags.boolean({
      description: "Check for updates without installing.",
    }),
    registry: Flags.string({
      description: "npm registry to use (e.g. http://npm.ix/ for local dev).",
      default: DEFAULT_REGISTRY,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Update);
    const registry = flags.registry;
    const current = this.config.version;

    const baseNotes = (
      <>
        <Note>{`registry ${blue(registry)}`}</Note>
        <Note>{`current  ${blue(current)}`}</Note>
      </>
    );

    let latest: string;
    try {
      latest = await spawnAsync("npm", [
        "view",
        "@agent-ix/ix",
        "version",
        "--registry",
        registry,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await renderStatic(
        <Listing
          header="ix update"
          status="failed"
          tail={`Could not reach registry: ${msg}`}
          tailVariant="error"
        >
          {baseNotes}
        </Listing>,
      );
      this.exit(1);
      return;
    }

    if (current === latest) {
      await renderStatic(
        <Listing
          header="ix update"
          status="passed"
          variant="flow"
          pre={<FlowLine>{`${blue(current)} from ${blue(registry)}`}</FlowLine>}
          tail={`Already up to date · ${blue(latest)}`}
        />,
      );
      return;
    }

    if (flags.check) {
      await renderStatic(
        <Listing
          header="ix update"
          status="passed"
          variant="flow"
          pre={<FlowLine>{`${blue(current)} from ${blue(registry)}`}</FlowLine>}
          tail={`Update available · ${blue(latest)}`}
          tailVariant="warn"
        />,
      );
      return;
    }

    // For the install: npm install -g writes its own progress directly to
    // stdout. We let it inherit, then render a final summary listing.
    try {
      await spawnInherited("npm", [
        "install",
        "-g",
        `@agent-ix/ix@${latest}`,
        "--registry",
        registry,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await renderStatic(
        <Listing
          header="ix update"
          status="failed"
          tail={`Install failed: ${msg}`}
          tailVariant="error"
        >
          {baseNotes}
          <Note>{`latest   ${blue(latest)}`}</Note>
        </Listing>,
      );
      this.exit(1);
      return;
    }

    await renderStatic(
      <Listing
        header="ix update"
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`${colors.dim(current)} → ${blue(latest)} via ${blue(registry)}`}</FlowLine>
        }
        tail={`Updated to ${blue(latest)}.`}
      />,
    );
  }
}

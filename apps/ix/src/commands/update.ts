import { Command, Flags } from "@oclif/core";
import { spawn } from "node:child_process";
import { startListing } from "@agent-ix/ix-ui-cli";
import pc from "picocolors";

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

export default class Update extends Command {
  static description = "Check for and install ix CLI updates.";

  static flags = {
    check: Flags.boolean({
      description: "Check for updates without installing.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Update);
    const list = startListing("ix update");

    const current = this.config.version;
    list.note(`current  ${pc.cyan(current)}`);

    let latest: string;
    try {
      latest = await spawnAsync("npm", [
        "view",
        "@agent-ix/ix",
        "version",
        "--registry",
        "http://npm.ix/",
      ]);
    } catch (err) {
      list.error(
        `Could not reach registry: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
      return;
    }

    list.note(`latest   ${pc.cyan(latest)}`);

    if (current === latest) {
      list.success("Already up to date.");
      return;
    }

    if (flags.check) {
      list.warn(`Update available: ${pc.cyan(latest)}`);
      return;
    }

    list.commit();

    try {
      await spawnInherited("npm", [
        "install",
        "-g",
        `@agent-ix/ix@${latest}`,
        "--registry",
        "http://npm.ix/",
      ]);
    } catch (err) {
      list.error(
        `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.exit(1);
      return;
    }

    list.success(`Updated to ${pc.cyan(latest)}`);
  }
}

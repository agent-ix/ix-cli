import { Command, Flags } from "@oclif/core";
import { spawn } from "node:child_process";
import React from "react";
import { Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";
import pc from "picocolors";

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

export default class Update extends Command {
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
        <Note>
          {`registry ${pc.cyan(registry)}`}
        </Note>
        <Note>
          {`current  ${pc.cyan(current)}`}
        </Note>
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
          tail="Already up to date."
        >
          {baseNotes}
          <Note>{`latest   ${pc.cyan(latest)}`}</Note>
        </Listing>,
      );
      return;
    }

    if (flags.check) {
      await renderStatic(
        <Listing
          header="ix update"
          status="passed"
          tail={`Update available: ${pc.cyan(latest)}`}
          tailVariant="warn"
        >
          {baseNotes}
          <Note>{`latest   ${pc.cyan(latest)}`}</Note>
        </Listing>,
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
          <Note>{`latest   ${pc.cyan(latest)}`}</Note>
        </Listing>,
      );
      this.exit(1);
      return;
    }

    await renderStatic(
      <Listing
        header="ix update"
        status="passed"
        tail={`Updated to ${pc.cyan(latest)}`}
      >
        {baseNotes}
        <Note>{`latest   ${pc.cyan(latest)}`}</Note>
      </Listing>,
    );
  }
}

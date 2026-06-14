import { Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import {
  FlowLine,
  Listing,
  Note,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

import { ixTokenStore, loggedInHostSlugs } from "../auth-engine.js";

/**
 * `ix logout [--host]` — forget stored credentials. With `--host`, clears one
 * service; otherwise clears every logged-in service. Deletes the host-keyed
 * access/refresh secrets and the config metadata
 * (ix://agent-ix/ix-cli-core/FR-017). Idempotent.
 */
export default class Logout extends BaseCommand {
  static description = "Forget stored Agent IX credentials.";
  static examples = ["ix logout", "ix logout --host filament.dev.ix"];

  static flags = {
    host: Flags.string({
      description: "Log out of a single service host instead of all of them.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Logout);
    const store = ixTokenStore();

    const targets = flags.host ? [flags.host] : loggedInHostSlugs();

    if (targets.length === 0) {
      await renderStatic(
        <Listing header="ix logout" status="passed" tail="nothing to do">
          <Note>You are not logged in to any service.</Note>
        </Listing>,
      );
      return;
    }

    for (const host of targets) {
      await store.clear(host);
    }

    await renderStatic(
      <Listing
        header="ix logout"
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`cleared ${blue(String(targets.length))} session(s)`}</FlowLine>
        }
        tail={
          flags.host
            ? `Logged out of ${blue(flags.host)}.`
            : "Logged out of all services."
        }
      />,
    );
  }
}

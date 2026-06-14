import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "@agent-ix/ix-cli-core";
import {
  DeviceFlowError,
  fetchServiceDiscovery,
  runDeviceFlow,
  type DeviceFlowPrompter,
} from "@agent-ix/ix-cli-core";
import {
  FlowLine,
  Listing,
  Note,
  blue,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

import {
  displayHost,
  IX_DEVICE_CLIENT_ID,
  ixTokenStore,
} from "../auth-engine.js";

/**
 * `ix login <host>` — service-first device login.
 *
 * Fetches `<host>/.well-known/agentix-service.json`, runs the generic
 * ix-cli-core device-flow engine (ix://agent-ix/ix-cli-core/FR-015,
 * /FR-016, /FR-018), and persists the resulting host-keyed,
 * audience-scoped token bundle via the IX `core` SecretsService + config
 * metadata (ix://agent-ix/ix-cli-core/FR-017).
 */
export default class Login extends BaseCommand {
  static description =
    "Authenticate to an Agent IX service via device-code login.";
  static examples = [
    "ix login filament.dev.ix",
    "ix login https://filament.dev.ix --no-browser",
  ];

  static args = {
    host: Args.string({
      required: true,
      description:
        "Service host to log into, e.g. filament.dev.ix. Discovery is read from <host>/.well-known/agentix-service.json.",
    }),
  };

  static flags = {
    "no-browser": Flags.boolean({
      description: "Do not attempt to open a browser; print the URL instead.",
      default: false,
    }),
    insecure: Flags.boolean({
      description:
        "Allow plain-HTTP discovery for non-.dev.ix hosts (development only).",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Login);
    const host = args.host;

    const prompter: DeviceFlowPrompter = {
      showVerification: async (info) => {
        const lines = [
          <Note key="code">{`code   ${blue(info.userCode)}`}</Note>,
          <Note key="url">{`open   ${blue(
            info.verificationUriComplete ?? info.verificationUri,
          )}`}</Note>,
          <Note key="hint">
            {info.browserOpened
              ? "A browser was opened — approve the request there."
              : "Open the URL above and enter the code to approve."}
          </Note>,
        ];
        await renderStatic(
          <Listing
            header={`ix login ${displayHost(host, flags.insecure)}`}
            status="pending"
            tail="waiting for approval…"
          >
            {lines}
          </Listing>,
        );
      },
    };

    try {
      const discovery = await fetchServiceDiscovery(host, {
        insecure: flags.insecure,
      });
      const bundle = await runDeviceFlow(discovery, {
        clientId: IX_DEVICE_CLIENT_ID,
        prompter,
        openBrowser: !flags["no-browser"],
      });
      await ixTokenStore().save(host, bundle);

      await renderStatic(
        <Listing
          header={`ix login ${displayHost(host, flags.insecure)}`}
          status="passed"
          variant="flow"
          pre={
            <FlowLine>{`${blue(discovery.service.display_name)} · audience ${blue(
              bundle.audience ?? discovery.audience,
            )}`}</FlowLine>
          }
          tail={`Logged in to ${blue(displayHost(host, flags.insecure))}.`}
        />,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const tail =
        err instanceof DeviceFlowError && err.code === "access_denied"
          ? "Login was denied in the browser."
          : message;
      await renderStatic(
        <Listing
          header={`ix login ${displayHost(host, flags.insecure)}`}
          status="failed"
          tail={tail}
          tailVariant="error"
        />,
      );
      this.exit(1);
    }
  }
}

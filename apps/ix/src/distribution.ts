import {
  createRuntimeDistribution,
  type IxPlugin,
} from "@agent-ix/ix-cli-core";
import {
  LocalConfigSchema,
  LocalEnvBindings,
  LocalSecretsSchema,
  LOCAL_PLUGIN_ID,
} from "@agent-ix/ix-cli-local";
import { workflowIxPlugin } from "@agent-ix/workflow-cli-plugin";

import {
  CORE_ID,
  CoreConfigSchema,
  CoreEnvBindings,
  CoreSecretsSchema,
} from "./core-plugin.js";

const coreIxPlugin: IxPlugin = {
  id: CORE_ID,
  configSchema: CoreConfigSchema,
  envBindings: CoreEnvBindings,
  secretsSchema: CoreSecretsSchema,
};

const localIxPlugin: IxPlugin = {
  id: LOCAL_PLUGIN_ID,
  configSchema: LocalConfigSchema,
  envBindings: LocalEnvBindings,
  secretsSchema: [...LocalSecretsSchema],
};

const elementsIxPlugin: IxPlugin = {
  id: "elements",
  capabilities: [{ id: "github", mode: "optional" }],
};

export const ixDistribution = createRuntimeDistribution({
  id: "ix",
  binaryName: "ix",
  configNamespace: "ix",
  configRootEnvVar: "IX_CONFIG_ROOT",
  ixServicesEnabled: true,
  defaultPlugins: [
    coreIxPlugin,
    localIxPlugin,
    elementsIxPlugin,
    workflowIxPlugin,
  ],
});

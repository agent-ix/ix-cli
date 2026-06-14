import {
  ConfigService,
  defaultSecretsService,
  hostSlug,
  normalizeHostOrigin,
  TokenStore,
  type TokenMeta,
  type TokenMetaStore,
} from "@agent-ix/ix-cli-core";

import {
  CORE_ID,
  CoreConfigSchema,
  CoreEnvBindings,
  type CoreConfig,
} from "./core-plugin.js";

/**
 * IX wiring for the generic ix-cli-core auth engine.
 *
 * The engine itself is service-agnostic
 * (ix://agent-ix/ix-cli-core/FR-015..FR-018); this module supplies the IX
 * defaults: the IX `core` plugin's `SecretsService` for token storage and a
 * `core.auth.hosts`-backed metadata store. The host is whatever the user
 * passes to `ix login <host>` — there is no hard-coded IX service.
 */

/** OAuth client id IX presents to the device-confirm flow. */
export const IX_DEVICE_CLIENT_ID = "ix-cli";

/**
 * Display host for `whoami` / `logout` output — the normalized origin without
 * the scheme (e.g. `filament.dev.ix`). Pure; never throws on a stored host.
 */
export function displayHost(host: string, insecure = false): string {
  try {
    return new URL(normalizeHostOrigin(host, insecure)).host;
  } catch {
    return host;
  }
}

/**
 * `TokenMetaStore` backed by the IX `core` plugin's `auth.hosts` config map.
 * Token VALUES are never written here — only `{expiresAt, audience, scope}`.
 */
export class CoreConfigTokenMetaStore implements TokenMetaStore {
  private config(): {
    get(): CoreConfig;
    set(partial: Partial<CoreConfig>): void;
  } {
    return ConfigService.forPlugin(CORE_ID, CoreConfigSchema, {
      envBindings: CoreEnvBindings,
    });
  }

  read(slug: string): TokenMeta | undefined {
    const hosts = this.config().get().auth.hosts ?? {};
    const entry = hosts[slug];
    return entry ? { ...entry } : undefined;
  }

  write(slug: string, meta: TokenMeta): void {
    const cfg = this.config();
    const current = cfg.get();
    const hosts = { ...(current.auth.hosts ?? {}) };
    hosts[slug] = {
      expiresAt: meta.expiresAt,
      ...(meta.audience !== undefined ? { audience: meta.audience } : {}),
      ...(meta.scope !== undefined ? { scope: meta.scope } : {}),
      ...(meta.host !== undefined ? { host: meta.host } : {}),
    };
    cfg.set({ auth: { ...current.auth, hosts } });
  }

  clear(slug: string): void {
    const cfg = this.config();
    const current = cfg.get();
    const hosts = { ...(current.auth.hosts ?? {}) };
    if (!(slug in hosts)) return;
    delete hosts[slug];
    cfg.set({ auth: { ...current.auth, hosts } });
  }
}

/** Build a `TokenStore` wired to the IX `core` secrets + config metadata. */
export function ixTokenStore(): TokenStore {
  return new TokenStore({
    secrets: defaultSecretsService(),
    meta: new CoreConfigTokenMetaStore(),
    pluginId: CORE_ID,
  });
}

/** Hosts the user has logged into, in stable sorted order. */
export function loggedInHostSlugs(): string[] {
  const cfg = ConfigService.forPlugin(CORE_ID, CoreConfigSchema, {
    envBindings: CoreEnvBindings,
  });
  return Object.keys(cfg.get().auth.hosts ?? {}).sort();
}

export { hostSlug };

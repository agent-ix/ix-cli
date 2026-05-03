/**
 * FR-021 — Concurrent Service Startup with Rate Control
 *
 * Semaphore pool for gating concurrent OCI pulls, Helm installs, and
 * kubectl watchers. Configuration is read via the shared
 * `ConfigService` (FR-010 / FR-012) under the `local` plugin's
 * `concurrency` subkey.
 */

import { ConfigService } from "@agent-ix/ix-cli-core";

import {
  LocalConfigSchema,
  LocalEnvBindings,
  LOCAL_PLUGIN_ID,
} from "./schema.js";

export interface ConcurrencyConfig {
  dockerPull: number;
  helmInstall: number;
  kubectlWatch: number;
}

export class ConcurrencyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyConfigError";
  }
}

/**
 * Resolve the active pool sizes via `ConfigService`. Layered: env →
 * `~/.config/ix/config.d/local.yaml` → schema defaults (3/5/10).
 */
export function loadConcurrencyConfig(): ConcurrencyConfig {
  const cfg = ConfigService.forPlugin(LOCAL_PLUGIN_ID, LocalConfigSchema, {
    envBindings: LocalEnvBindings,
  });
  return cfg.get().concurrency;
}

/** Simple counting semaphore. Safe in Node.js single-threaded event loop. */
export class Pool {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly size: number) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(
        `Pool size must be a positive integer ≥ 1 (got ${size})`,
      );
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.size) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export interface Pools {
  dockerPull: Pool;
  helmInstall: Pool;
  kubectlWatch: Pool;
}

export function createPools(config: ConcurrencyConfig): Pools {
  return {
    dockerPull: new Pool(config.dockerPull),
    helmInstall: new Pool(config.helmInstall),
    kubectlWatch: new Pool(config.kubectlWatch),
  };
}

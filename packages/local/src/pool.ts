/**
 * FR-021 — Concurrent Service Startup with Rate Control
 *
 * Semaphore pool for gating concurrent OCI pulls, Helm installs, and
 * kubectl watchers. Configuration loaded through ix-cli-core with
 * safe defaults when the file is absent.
 */

import os from "node:os";
import path from "node:path";
import { loadIxCliConfig } from "@agent-ix/ix-cli-core";

export interface ConcurrencyConfig {
  dockerPull: number;
  helmInstall: number;
  kubectlWatch: number;
}

const DEFAULTS: ConcurrencyConfig = {
  dockerPull: 3,
  helmInstall: 5,
  kubectlWatch: 10,
};

const CONFIG_PATH = path.join(os.homedir(), ".ix", "config.yaml");

interface LocalIxCliConfig {
  concurrency?: {
    docker_pull?: number;
    helm_install?: number;
    kubectl_watch?: number;
  };
}

export class ConcurrencyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyConfigError";
  }
}

export function loadConcurrencyConfig(): ConcurrencyConfig {
  try {
    const concurrency = (loadIxCliConfig() as LocalIxCliConfig).concurrency;
    if (concurrency === undefined || concurrency === null)
      return { ...DEFAULTS };
    if (typeof concurrency !== "object" || Array.isArray(concurrency)) {
      throw new ConcurrencyConfigError(
        `${CONFIG_PATH}: 'concurrency' must be an object`,
      );
    }
    const c = concurrency as Record<string, unknown>;

    function resolvePoolSize(key: string, fallback: number): number {
      const val = c[key];
      if (val === undefined) return fallback;
      if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
        throw new ConcurrencyConfigError(
          `${CONFIG_PATH}: concurrency.${key} must be a positive integer >= 1 (got: ${JSON.stringify(val)})`,
        );
      }
      return val;
    }

    return {
      dockerPull: resolvePoolSize("docker_pull", DEFAULTS.dockerPull),
      helmInstall: resolvePoolSize("helm_install", DEFAULTS.helmInstall),
      kubectlWatch: resolvePoolSize("kubectl_watch", DEFAULTS.kubectlWatch),
    };
  } catch (err) {
    if (err instanceof ConcurrencyConfigError) throw err;
    throw new ConcurrencyConfigError(
      `Failed to read ${CONFIG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

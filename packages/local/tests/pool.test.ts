import { describe, expect, it } from "vitest";
import { Pool, createPools } from "../src/pool.js";

describe("Pool", () => {
  it("queues work when a pool slot is unavailable", async () => {
    const pool = new Pool(1);
    let releaseFirst!: () => void;
    const first = pool.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    const second = pool.run(async () => "second");
    await Promise.resolve();

    expect(pool.activeCount).toBe(1);
    expect(pool.pendingCount).toBe(1);

    releaseFirst();
    await expect(second).resolves.toBe("second");
    await first;
    expect(pool.activeCount).toBe(0);
    expect(pool.pendingCount).toBe(0);
  });

  it("creates independent pools from concurrency config", () => {
    const pools = createPools({
      dockerPull: 1,
      helmInstall: 2,
      kubectlWatch: 3,
    });

    expect(pools.dockerPull).toBeInstanceOf(Pool);
    expect(pools.helmInstall).toBeInstanceOf(Pool);
    expect(pools.kubectlWatch).toBeInstanceOf(Pool);
    expect(pools.dockerPull).not.toBe(pools.helmInstall);
  });

  it("rejects invalid pool sizes", () => {
    expect(() => new Pool(0)).toThrow(RangeError);
    expect(() => new Pool(1.5)).toThrow(RangeError);
  });
});
